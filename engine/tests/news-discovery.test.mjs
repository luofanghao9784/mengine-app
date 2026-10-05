import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverNews, pagePublication } from '../dist/runtime/news-discovery.js';
import { PublicReader, PublicWebTask } from '../dist/runtime/public-web.js';
const date=new Date(Date.now()-86400000).toISOString();
test('RSS and Atom discover recent same-origin articles without duplicate or private queries',()=>{
 const rss=`<rss><channel><item><title>近期行业政策说明</title><link>https://publisher.example.org/a</link><pubDate>${date}</pubDate></item><item><title>重复政策标题</title><link>https://publisher.example.org/a</link></item><item><title>过期政策标题</title><link>https://publisher.example.org/old</link><pubDate>2020-01-01</pubDate></item><item><title>外部跳转标题</title><link>https://other.example.org/x</link></item></channel></rss>`;
 assert.deepEqual(discoverNews(rss,'https://publisher.example.org/feed').map(x=>x.url),['https://publisher.example.org/a']);
 assert.equal(discoverNews(`<feed><entry><title>企业行业资讯文章</title><link href="https://publisher.example.org/b"/><published>${date}</published></entry></feed>`,'https://publisher.example.org/atom')[0].publishedAt,date);
});
test('HTML discovery tolerates standard doctype and removes navigation and fragments',()=>{
 const body='<!DOCTYPE html><html><nav><a href="/nav">这是导航不是新闻</a></nav><main><a href="/article#section">行业最新相关资讯</a><a href="http://127.0.0.1">内部恶意链接</a></main></html>';
 assert.deepEqual(discoverNews(body,'https://publisher.example.org/list').map(x=>x.url),['https://publisher.example.org/article']);
 assert.equal(discoverNews('<!DOCTYPE rss [<!ENTITY leak SYSTEM "file:///private">]><rss/>','https://publisher.example.org').length,0);
 assert.equal(pagePublication(`<meta property="article:published_time" content="${date}">`),date);
 assert.equal(pagePublication('<meta property="article:published_time" content="not a date">'),undefined);
});
test('news discovery grants discovered article IDs, retains date and denies arbitrary reads',async()=>{
 const calls=[];const reader=new PublicReader(async()=>[{address:'8.8.8.8',family:4}],async u=>{calls.push(u.href);return{status:200,headers:{'content-type':'text/html'},bytes:Buffer.from(u.pathname==='/list'?`<a href="/a">真实合成资讯标题</a>`:`<title>资讯文章</title><meta property="article:published_time" content="${date}"><p>合成正文与企业行业有关。</p>`)}});
 const task=new PublicWebTask('https://publisher.example.org/list',reader,undefined,true);const found=await task.find(new AbortController().signal);assert.equal(found.length,1);const read=await task.read(found[0].id,new AbortController().signal);assert.equal(read.publishedAt,date);await assert.rejects(task.read('not-granted',new AbortController().signal));assert.deepEqual(calls,['https://publisher.example.org/list','https://publisher.example.org/a']);
});
test('previous delivered article hash suppresses duplicate while changed body remains eligible',async()=>{
 let body='首次正文';const reader=new PublicReader(async()=>[{address:'8.8.8.8',family:4}],async u=>({status:200,headers:{'content-type':'text/html'},bytes:Buffer.from(u.pathname==='/list'?'<a href="/a">公开行业动态文章</a>':`<title>公开行业动态文章</title><p>${body}</p>`)}));
 const first=await new PublicWebTask('https://publisher.example.org/list',reader,undefined,true).find(new AbortController().signal);assert.equal(first.length,1);
 const seen=first.map(({url,sha256})=>({url,sha256}));assert.equal((await new PublicWebTask('https://publisher.example.org/list',reader,undefined,true,seen).find(new AbortController().signal)).length,0);
 body='后续进展正文';assert.equal((await new PublicWebTask('https://publisher.example.org/list',reader,undefined,true,seen).find(new AbortController().signal)).length,1);
});
