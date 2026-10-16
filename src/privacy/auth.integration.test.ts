import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { withCredentialLookup, withPrivateUser } from "./access";
const url=process.env.PRIVACY_TEST_DATABASE_URL;
if(!url||!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/privacy_test(?:\?|$)/.test(url))throw new Error("Use isolated privacy_test on port 55439.");
process.env.DATABASE_URL=url;process.env.DIRECT_URL=url;
process.env.EMAIL_PROVIDER="disabled";
process.env.GOOGLE_CLIENT_ID="synthetic.apps.googleusercontent.com";
process.env.PRIVATE_DATA_KEYRING_JSON=JSON.stringify({auth:`base64:${randomBytes(32).toString("base64")}`});process.env.PRIVATE_DATA_ACTIVE_KEY_ID="auth";process.env.PRIVATE_DATA_LOOKUP_KEY=`base64:${randomBytes(32).toString("base64")}`;
const raw=new PrismaClient({log:[]});const id=randomUUID(),otherId=randomUUID(),email=`${id}@example.test`,sample=`PRIVATE-AUTH-${id}`;
async function run(){
 const createdIds:string[]=[];
 const {prisma}=await import("../lib/prisma");const auth=await import("../services/auth.service");const {verifyAccessToken}=await import("../utils/jwt");
 const sql=(await fs.readFile("prisma/migrations/20261015230000_private_auth_profile_fields/migration.sql","utf8")).replace(/^\s*--.*$/gm,"").split(";").filter(item=>item.trim());
 const present=await raw.$queryRaw<Array<{present:boolean}>>`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='private_email') AS present`;
 if(!present[0].present)for(const statement of sql.filter(item=>!item.includes("ADD CONSTRAINT")))await raw.$executeRawUnsafe(statement);
 for(const table of ["User","signup_verifications","ExternalIdentity"])await raw.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_private_v2"`);
 try{
  await raw.user.createMany({data:[{id,name:sample,email,passwordHash:await bcrypt.hash("test-password-123!",4),country:"IN",passportCountry:"US",homeCurrency:"USD"},{id:otherId,name:"Other",email:`${otherId}@example.test`}]});
  const pending=await raw.signupVerification.create({data:{email:`signup-${email}`,name:sample,passwordHash:await bcrypt.hash("test-password-123!",4),otpHash:"restricted-verifier",expiresAt:new Date(Date.now()+60_000)}});
  const identity=await raw.externalIdentity.create({data:{userId:id,provider:"google",providerAccountId:sample,avatarUrl:`https://example.test/${sample}`}});
  for(const statement of sql.filter(item=>item.includes("ADD CONSTRAINT")))await raw.$executeRawUnsafe(statement);
  const migrate=(...args:string[])=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/scripts/migratePrivateRecords.ts",...args],{env:process.env,encoding:"utf8"}).trim());
  assert.equal(migrate().models.User.pending,2);assert.equal(migrate("--apply").models.User.updated,2);assert.equal(migrate("--verify").models.User.pending,0);assert.equal(migrate("--apply").models.User.updated,0);
  const stored=await raw.user.findUniqueOrThrow({where:{id}});assert(!JSON.stringify(stored).includes(sample));assert(!JSON.stringify(stored).includes(email));assert(!["IN","US","USD"].includes(stored.country!));
  await assert.rejects(prisma.user.findUnique({where:{id}}),/not found/);
  const credentials=await withCredentialLookup(()=>prisma.user.findUniqueOrThrow({where:{email},select:{id:true,passwordHash:true}}));assert.equal(credentials.id,id);
  await assert.rejects(withCredentialLookup(()=>prisma.user.findUnique({where:{email},select:{name:true}})),/PROJECTION_REJECTED/);
  await assert.rejects(withCredentialLookup(()=>prisma.user.findFirst({where:{email:{contains:"example"}},select:{id:true}})),/LOOKUP_REJECTED/);
  await assert.rejects(auth.login({email,password:"wrong"}),/Invalid email or password/);
  const signed=await auth.login({email,password:"test-password-123!"});assert.equal(signed.user.name,sample);assert.equal(signed.user.email,email);
  const claims=verifyAccessToken(signed.accessToken);assert(!("email" in claims));assert(!("name" in claims));
  const renewed=await auth.refresh({refreshToken:signed.refreshToken});assert.equal(renewed.user.email,email);
  await assert.rejects(auth.refresh({refreshToken:signed.refreshToken}),/Invalid refresh token/);
  await withPrivateUser(id,async()=>{await auth.setupPin(id,{pin:"012345"});assert.equal((await auth.getUserById(id))?.name,sample);});
  assert.equal((await auth.loginWithPin({email,pin:"012345"})).user.id,id);
  const validName=(await raw.user.findUniqueOrThrow({where:{id}})).private_name!;
  await raw.user.update({where:{id},data:{private_name:validName.slice(0,-4)+"AAAA"}});
  try{await assert.rejects(auth.loginWithPin({email,pin:"999999"}),/Invalid email or PIN/);}finally{await raw.user.update({where:{id},data:{private_name:validName}});}

  await withPrivateUser(otherId,async()=>{await assert.rejects(prisma.user.findUnique({where:{id}}),/not found/);await assert.rejects(prisma.externalIdentity.findUnique({where:{id:identity.id}}),/not found/);});
  const google=await auth.googleLogin({credential:"synthetic-verified-token"},async()=>({sub:sample,email,email_verified:true,aud:"synthetic",iss:"https://accounts.google.com",iat:1,exp:9999999999}));assert.equal(google.user.id,id);
  const emailService=await import("../services/email/emailService");let deliveredOtp="";
  emailService.setEmailProviderForTests({sendEmail:async input=>{const match=input.text.match(/\b[0-9]{6}\b/);if(match)deliveredOtp=match[0];return {messageId:"synthetic-no-delivery"};}});
  try{
   const signupEmail=`new-${email}`,signupPassword="Synthetic-Test-123!";
   await auth.requestSignupOtp({name:sample,email:signupEmail,password:signupPassword});assert.match(deliveredOtp,/^[0-9]{6}$/);
   assert(!JSON.stringify(await raw.signupVerification.findMany()).includes(sample));
   const signupOtp=deliveredOtp;
   await assert.rejects(auth.signup({name:sample,email:signupEmail,password:signupPassword,otp:signupOtp==="000000"?"111111":"000000"}),/Invalid or expired/);
   const signedUp=await auth.signup({name:sample,email:signupEmail,password:signupPassword,otp:signupOtp});createdIds.push(signedUp.user.id);assert.equal(signedUp.user.name,sample);
   await assert.rejects(auth.signup({name:sample,email:signupEmail,password:signupPassword,otp:signupOtp}),/already exists/);
   let changedEmail="";
   await withPrivateUser(signedUp.user.id,async()=>{
    changedEmail=`changed-${email}`;await auth.requestEmailChange(signedUp.user.id,{newEmail:changedEmail,currentPassword:signupPassword});
    const changeOtp=deliveredOtp;assert(!JSON.stringify(await raw.accountChangeOtp.findMany({where:{userId:signedUp.user.id}})).includes(changedEmail));
    await auth.verifyEmailChange(signedUp.user.id,{otp:changeOtp});assert.equal((await auth.getUserById(signedUp.user.id))?.email,changedEmail);
   });
   await auth.requestPasswordResetOtp({email:changedEmail});const resetOtp=deliveredOtp;
   await auth.resetPasswordWithOtp({email:changedEmail,otp:resetOtp,password:"Replacement-Test-456!"});
   assert.equal((await auth.login({email:changedEmail,password:"Replacement-Test-456!"})).user.id,signedUp.user.id);
  }finally{await new Promise(resolve=>setTimeout(resolve,30));emailService.setEmailProviderForTests(null);}
  await assert.rejects(raw.user.update({where:{id},data:{name:sample}}));
  for(const table of ["User","signup_verifications","ExternalIdentity"])await raw.$executeRawUnsafe(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${table}_private_v2"`);
  console.log("PASS: encrypted auth/profile/pending signup/Google identity, migration, credential-only discovery, password/PIN/refresh verified before profile decryption, minimal JWTs, uniqueness, raw-write rejection and cross-user isolation.");
 }finally{await raw.signupVerification.deleteMany();await raw.user.deleteMany({where:{id:{in:[id,otherId,...createdIds]}}});await Promise.all([raw.$disconnect(),prisma.$disconnect()]);}
}
function pendingEmail(){return `signup-${email}`;}
run().catch(error=>{console.error("Auth privacy test failed.",{name:error.name,code:error.code,argument:String(error.message).match(/Unknown argument `([A-Za-z_]+)`/)?.[1],frames:String(error.stack).split("\n").filter((line:string)=>/^\s+at /.test(line)).slice(-5)});process.exitCode=1;});
