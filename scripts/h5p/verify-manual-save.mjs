/** Browser-submit real native editor forms with synthetic, schema-valid content in isolated storage. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { chromium } from '@playwright/test';
import { fixtureFor } from '../../e2e/h5p-fixtures.mjs';
import { getStudioCatalog } from '../../routes/create/services/h5pStudioCatalog.js';
const require = createRequire(import.meta.url);
const renderEditor = require('@lumieducation/h5p-server/build/src/renderers/default.js').default;
const output = path.resolve(process.argv[2] || 'artifacts/h5p-maintenance/manual-save');
fs.mkdirSync(output,{recursive:true});
const storage = fs.mkdtempSync(path.join(os.tmpdir(),'create-h5p-manual-save-'));
process.env.H5P_STORAGE_ROOT = storage;
const { initializeLumi, getEditor, getH5PExpressRouter } = await import('../../routes/create/services/lumiService.js');
const catalog = getStudioCatalog();
const user = { id:'manual-save-browser-test', name:'Browser QA', type:'local' };
let server,browser;
const results=[];
try {
  await initializeLumi();
  getEditor().contentTypeCache.get=async()=>[];
  const app=express();
  app.use(express.json(),express.urlencoded({extended:true}),(req,_res,next)=>{req.user=user;next();});
  app.get('/editor',async(req,res,next)=>{
    try {
      const type=catalog.types.find(type=>type.machineName===req.query.type && type.mode==='manual');
      if(!type) return res.status(404).send('Unknown type');
      const params=fixtureFor(type.library);
      const model=await getEditor().render(undefined,'en',user);
      const initial=process.env.H5P_VERIFY_BLANK ? undefined : {params,metadata:{title:`Browser QA ${type.title}`,license:'U'}};
      const html=renderEditor(model).replaceAll('h5peditor = new ns.Editor(undefined, undefined, $editor[0]);',
        `h5peditor = window.acceptanceEditor = new ns.Editor(${JSON.stringify(type.library)}, ${JSON.stringify(JSON.stringify(initial))}, $editor[0]);`);
      res.send(html);
    } catch(error){next(error);}
  });
  app.post('/editor',async(req,res)=>{
    try{
      const {library,params}=req.body;
      const result=await getEditor().saveOrUpdateContentReturnMetaData(undefined,params.params,params.metadata,library,user);
      res.type('text/plain').send(JSON.stringify({contentId:result.id}));
    }catch(error){res.status(422).json({error:error.message});}
  });
  app.get('/api/create/h5p-editor/runtime/play/:id',async(req,res)=>{
    try{
      const content=await getEditor().getContent(req.params.id,user);
      res.send(`<h1>Saved and reopened</h1><p>${content.library}</p><p>${content.h5p?.title||''}</p>`);
    }catch(error){res.status(422).send(error.message);}
  });
  app.use('/api/create/h5p-editor/runtime',getH5PExpressRouter());
  server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  for(const type of catalog.types.filter(type=>type.mode==='manual' && (!process.env.H5P_VERIFY_TYPE || type.machineName===process.env.H5P_VERIFY_TYPE))){
    const result={machineName:type.machineName,library:type.library,version:type.version,status:'unknown',errors:[]};
    let postResult;
    const onResponse=async response=>{
      if(response.request().method()==='POST' && response.url().startsWith(origin+'/editor')){
        try{postResult={status:response.status(),body:await response.text()};}catch{}
      }
    };
    page.on('response',onResponse);
    try{
      await page.goto(`${origin}/editor?type=${encodeURIComponent(type.machineName)}`);
      await page.waitForFunction(()=>window.acceptanceEditor?.selector?.form &&
        Object.entries(window.acceptanceEditor.iframeWindow.H5PEditor.libraryCache||{}).every(([n,v])=>v!==0 && window.acceptanceEditor.iframeWindow.H5PEditor.libraryLoaded[n]),null,{timeout:20000});
      await page.waitForTimeout(700);
      const typedTitle = `Browser QA typed ${type.title}`;
      if (!process.env.H5P_VERIFY_BLANK) {
        const titleField = page.frameLocator('iframe').locator('input[id^="field-extratitle"]').first();
        await titleField.click();
        await titleField.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await titleField.pressSequentially(typedTitle);
        await titleField.press('Tab');
      }
      if (process.env.H5P_VERIFY_BLANK && type.machineName === 'H5P.Flashcards') {
        const editor = page.frameLocator('iframe');
        await editor.getByRole('textbox', { name: 'Title' }).first().fill('Browser QA manually entered Flashcards');
        await editor.getByRole('textbox', { name: 'Task description' }).fill('Which star is closest to Earth?');
        await editor.getByRole('textbox', { name: 'Question' }).fill('Closest star to Earth?');
        await editor.getByRole('textbox', { name: 'Answer' }).fill('The Sun');
        if (process.env.H5P_VERIFY_OPEN_METADATA) {
          await editor.getByRole('button', { name: 'Metadata' }).click();
          await editor.locator('.h5p-metadata-popup-overlay input[id^="field-title"]').fill('Browser QA manually entered Flashcards');
          await editor.getByRole('button', { name: 'Save metadata' }).click();
        }
      }
      await page.locator('#save-h5p').click();
      await page.waitForURL(/\/play\/\d+/, {timeout:8000});
      if(page.url().includes('/play/')){
        const text=await page.locator('body').innerText();
        if(!text.includes('Saved and reopened') || !text.includes(type.library) || (!process.env.H5P_VERIFY_BLANK && !text.includes(typedTitle))) {
          throw new Error(`Reopen did not match ${type.library} and typed title: ${text.slice(0,160)}`);
        }
        result.status='saved-reopened-via-browser';
        result.contentId=page.url().split('/').at(-1);
        if (!process.env.H5P_VERIFY_BLANK) result.typedTitle = typedTitle;
      }else throw new Error(`Editor did not submit/redirect: ${JSON.stringify(postResult)}`);
      await page.screenshot({path:path.join(output,`${type.machineName}.png`)});
    } catch (error) {
      result.status = 'failed';
      result.errors.push(error.message);
      result.postResult = postResult;
      result.formErrors = await page.evaluate(() => {
        const e = window.acceptanceEditor;
        const form = e?.selector?.form;
        const walk = (x, depth = 0) => {
          if (!x || depth > 4) return null;
          let valid;
          try { valid = x.validate?.(); } catch (err) { valid = `THREW ${err.message}`; }
          return {
            name: x.field?.name,
            type: x.field?.type,
            valid,
            children: (x.children || []).map(c => walk(c, depth + 1)),
            items: (x.items || []).map(c => walk(c, depth + 1))
          };
        };
        return { form: walk(form), text: e?.iframeWindow?.document?.body?.innerText?.slice(0, 10000) };
      }).catch(err => ({ error: err.message }));
      await page.screenshot({ path: path.join(output, `${type.machineName}-failed.png`), fullPage: true }).catch(() => {});
    }
    page.off('response',onResponse);
    results.push(result);
    console.log(result.status,type.machineName,result.errors.join('; '));
  }
  const scope = process.env.H5P_VERIFY_BLANK
    ? 'Blank Flashcards native editor filled through browser controls, submitted, saved, and reopened in temporary storage. Does not test the authenticated CREATE React/Mongo flow.'
    : 'Native editor browser submit with synthetic prefilled content fields and a keyboard-typed title in every form; saved and reopened from temporary storage. Does not prove manually entering every content field, media playback, scoring, or external services.';
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({scope,results},null,2)+'\n');
  if(results.some(x=>x.status==='failed'))process.exitCode=1;
}finally{
  await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(storage,{recursive:true,force:true});
}
