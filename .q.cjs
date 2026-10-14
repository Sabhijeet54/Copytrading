require('dotenv').config({path: process.cwd()+'/.env'});
const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL.split('?')[0]});
(async()=>{await c.connect();
const r=await c.query(`select id,broker,"brokerClientId",status,mode,"isPaper","tokenExpiresAt","disconnectReason","disconnectedAt","lastError","updatedAt" from "BrokerAccount" where broker='ANGEL_ONE' order by "updatedAt" desc limit 5`);console.table(r.rows);
const a=await c.query(`select action,"createdAt",metadata from "AuditLog" where action ilike '%BROKER%' order by "createdAt" desc limit 15`);console.log(a.rows.map(x=>[x.createdAt.toISOString(),x.action,JSON.stringify(x.metadata).slice(0,200)].join(' | ')).join('\n'));
await c.end()})().catch(e=>console.error(e.message));
