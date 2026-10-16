import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { decryptString, decryptJson, decryptDocumentBuffer } from "../../src/utils/documentEncryption";
import { decryptHybridDocument, isHybridEncryptionMetadata } from "../../src/services/documentHybridEncryption";
import { decryptGmailToken } from "../../src/services/gmail/tokenEncryption";
import { getStorageProvider } from "../../src/infrastructure/storage/createStorageProvider";
import { assertPrivateDataKeysConfigured } from "../../src/privacy/fieldEncryption";
import { productionTargetSummary } from "../../src/privacy/productionTargetSummary";

// Read-only build check. No secrets, record IDs, names, values or hashes print.
async function run() {
 if(process.env.VERCEL!=="1"||process.env.VERCEL_ENV!=="production"||process.env.VERCEL_PROJECT_ID!=="prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82"||process.env.PRIVATE_BACKUP_ENABLED!=="1")throw Error("CONTEXT_REQUIRED");
 assertPrivateDataKeysConfigured();const target=productionTargetSummary(process.env);if(target.databaseProjectRef!=="izsujcwyuirkzkafhfnp"||target.directProjectRef!==target.databaseProjectRef||target.storageProjectRef!==target.databaseProjectRef)throw Error("TARGET_MISMATCH");
 const db=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}},log:[]});
 let strings=0,json=0,tokens=0,files=0,referencesWithoutObjects=0;
 try {
  const tables=await db.$queryRaw<Array<{name:string}>>`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY 1`;
  for(const {name}of tables){if(!/^[A-Za-z_]+$/.test(name))throw Error("INVALID_TABLE");
   const rows=await db.$queryRawUnsafe<Array<{data:Record<string,unknown>}>>(`SELECT row_to_json(t) AS data FROM public."${name}" t`);
   for(const {data}of rows)for(const [field,value]of Object.entries(data)){
    if(typeof value==='string'&&value.startsWith('enc:v1:')){decryptString(value);strings++;}
    if(value&&typeof value==='object'&&'__lifepackEncrypted' in value){decryptJson(value,null);json++;}
    if(name==='ExternalConnection'&&field==='encryptedRefreshToken'&&typeof value==='string'){decryptGmailToken(value);tokens++;}
   }
   if(name==='Document'||name==='DocumentFile')for(const {data}of rows){
    const text=(key:string)=>typeof data[key]==='string'?decryptString(data[key] as string):null;
    const location=text('storageKey')||text('path');if(!location){referencesWithoutObjects++;continue;}
    if(location.startsWith('/')||location.includes('://'))throw Error('UNSUPPORTED_OBJECT_REFERENCE');
    const body=await getStorageProvider().download(location);
    const metadata={...data,wrappedKey:text('wrappedKey'),originalSha256:text('originalSha256')};
    let plaintext:Buffer;
    if(isHybridEncryptionMetadata(metadata)){
     plaintext=decryptHybridDocument(body,{keyId:metadata.keyId,keyVersion:metadata.keyVersion,iv:metadata.encryptionIv,wrappedKey:metadata.wrappedKey});
    }else plaintext=decryptDocumentBuffer(body);
    try{const expected=text('originalSha256');if(expected&&createHash('sha256').update(plaintext).digest('hex')!==expected)throw Error('OBJECT_HASH_MISMATCH');files++;}finally{plaintext.fill(0);body.fill(0);}
   }
  }
  console.log(JSON.stringify({legacyCiphertextAuthenticationPassed:true,stringEnvelopesAuthenticated:strings,jsonEnvelopesAuthenticated:json,oauthTokensAuthenticated:tokens,fileReferencesAuthenticated:files,referencesWithoutObjects,existingApplicationKeysExported:false,productionWrites:false}));
 }finally{await db.$disconnect();}
}
run().then(()=>{process.exitCode=42;}).catch(()=>{console.error(JSON.stringify({code:'LEGACY_CIPHERTEXT_CHECK_FAILED',productionWrites:false}));process.exitCode=1;});
