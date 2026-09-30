import http from 'node:http';
import {readFile} from 'node:fs/promises';
import worker from './worker.mjs';
const port=Number(process.env.PORT || 8787);
const files={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript'],'/styles.css':['styles.css','text/css']};
const env={SEC_USER_AGENT:process.env.SEC_USER_AGENT,ASSETS:{async fetch(request){const item=files[new URL(request.url).pathname];return item?new Response(await readFile(new URL('./public/'+item[0],import.meta.url)),{headers:{'Content-Type':item[1]}}):new Response('Not found',{status:404});}}};
http.createServer(async(req,res)=>{try{const response=await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method}),env,{waitUntil:p=>p.catch(console.error)});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.writeHead(500);res.end(error.message);}}).listen(port,'127.0.0.1',()=>console.log(`Folio: http://127.0.0.1:${port}`));
