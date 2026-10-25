import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { withPrivateUser } from "../privacy/access";
import { prisma } from "../lib/prisma";
import { login, refresh, logout, getUserById } from "./auth.service";
import { verifyAccessToken } from "../utils/jwt";
const url=new URL(process.env.DATABASE_URL||"http://invalid");
test("logout and refresh rotation immediately revoke corresponding access tokens",{skip:url.hostname!=="127.0.0.1"||url.port!=="55439"||url.pathname!=="/readines_audit_test"},async()=>{
  const raw=new PrismaClient({log:[]});const id=randomUUID(),email=`${id}@example.test`;
  try{await withPrivateUser(id,()=>prisma.user.create({data:{id,name:"Session audit",email,passwordHash:undefined},select:{id:true}}));
    await raw.user.update({where:{id},data:{passwordHash:await bcrypt.hash("Audit-password-123!",4)}});
    const one=await login({email,password:"Audit-password-123!"});const first=verifyAccessToken(one.accessToken);assert(first.sid);
    assert(await withPrivateUser(id,()=>getUserById(id,first.authVersion,first.sid)));
    const two=await refresh({refreshToken:one.refreshToken});const second=verifyAccessToken(two.accessToken);assert(second.sid);assert.notEqual(first.sid,second.sid);
    assert.equal(await withPrivateUser(id,()=>getUserById(id,first.authVersion,first.sid)),null);
    await logout({refreshToken:two.refreshToken});assert.equal(await withPrivateUser(id,()=>getUserById(id,second.authVersion,second.sid)),null);
    await assert.rejects(refresh({refreshToken:two.refreshToken}));
  }finally{await raw.user.deleteMany({where:{id}});await Promise.all([raw.$disconnect(),prisma.$disconnect()]);}
});
