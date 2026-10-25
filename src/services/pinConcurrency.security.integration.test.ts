import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { withPrivateUser } from "../privacy/access";
import { loginWithPin } from "./auth.service";
import { acceptInvitation } from "./trustCenter.service";
const url=new URL(process.env.DATABASE_URL||"http://invalid");
const isolated=url.hostname==="127.0.0.1"&&url.port==="55439"&&url.pathname==="/readines_audit_test";
test("concurrent account and invitation PIN failures cannot lose lockout increments",{skip:!isolated},async()=>{
  const raw=new PrismaClient({log:[]});const id=randomUUID(),email=`${id}@example.test`,token=randomUUID();const hash=await bcrypt.hash("012345",4);
  try{
    await withPrivateUser(id,()=>prisma.user.create({data:{id,name:"PIN audit",email,pinHash:hash},select:{id:true}}));
    const invitation=await withPrivateUser(id,()=>prisma.trustMember.create({data:{ownerUserId:id,name:"Recipient",email:`recipient-${email}`,relation:"CHILD",dateOfBirth:"2000-01-01",bloodGroup:"O+",accessType:"FAMILY_MEMBER",status:"INVITED",inviteTokenHash:createHash("sha256").update(token).digest("hex"),invitePinHash:hash,inviteExpiresAt:new Date(Date.now()+60000)},select:{id:true}}));
    const attempts=await Promise.allSettled(Array.from({length:12},()=>loginWithPin({email,pin:"999999"})));assert(attempts.every(r=>r.status==="rejected"));
    const user=await raw.user.findUniqueOrThrow({where:{id}});assert.equal(user.pinAttemptCount,5);assert(user.pinLockedUntil!>new Date());await assert.rejects(loginWithPin({email,pin:"012345"}));
    const invitations=await Promise.allSettled(Array.from({length:12},()=>acceptInvitation(token,{pin:"999999"})));assert(invitations.every(r=>r.status==="rejected"));
    const member=await raw.trustMember.findUniqueOrThrow({where:{id:invitation.id}});assert.equal(member.pinAttemptCount,5);assert(member.pinLockedUntil!>new Date());await assert.rejects(acceptInvitation(token,{pin:"012345"}));
    await raw.user.update({where:{id},data:{pinLockedUntil:new Date(Date.now()-1000)}});assert.equal((await loginWithPin({email,pin:"012345"})).user.id,id);
    await raw.trustMember.update({where:{id:invitation.id},data:{pinLockedUntil:new Date(Date.now()-1000)}});await acceptInvitation(token,{pin:"012345"});await assert.rejects(acceptInvitation(token,{pin:"012345"}));
  }finally{await raw.user.deleteMany({where:{id}});await Promise.all([raw.$disconnect(),prisma.$disconnect()]);}
});
