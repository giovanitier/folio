"""Offline DOM regression checks with explicit fetch and storage test doubles.

This exercises rendering and interactions without browser networking.
It does not verify deployed HTTP, CSP enforcement, native storage, or SEC access.
Requires Python Playwright and Chromium; no network requests are made.
"""
import json
import os
from pathlib import Path
import re
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('FOLIO_SCREENSHOTS', '/tmp/folio-offline-checks'))
OUT.mkdir(parents=True, exist_ok=True)
fixture = json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {directory,dashboard} from './tests/fixtures.mjs';import {INVESTORS} from './worker.mjs';console.log(JSON.stringify({directory,dashboard,INVESTORS}))"],cwd=ROOT))
html=(ROOT/'public/index.html').read_text()
html=re.sub(r'<link[^>]*>|<script[^>]*>.*?</script>','',html,flags=re.S)
css='\n'.join((ROOT/path).read_text() for path in ['public/vendor/syntari/runtime/tokens.css','public/vendor/syntari/app-shell.css','public/vendor/syntari/controls.css','public/styles.css'])
css=re.sub(r'@import[^;]+;','',css)
html=html.replace('</head>',f'<style>{css}</style></head>')
code=re.sub(r'^export ', '',(ROOT/'public/model.js').read_text(),flags=re.M)+'\nconst e=escapeHTML;\n'+re.sub(r'^import .*?;\n','',(ROOT/'public/app.js').read_text(),flags=re.M)
checks=[]
errors=[]

def check(label): checks.append(label)
def fits(page,label):
    sizes=page.evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})')
    assert sizes['document']<=sizes['viewport'],(label,sizes)
    check(label)

def mount(context,configured=False,storage=None,data=None):
    page=context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(html)
    health={'ok':True,'service':'folio','version':'0.3.0','secConfigured':configured,'configuration':'configured' if configured else 'missing','upstream':'not_checked'}
    payload={'directory':fixture['directory'] if configured else fixture['INVESTORS'],'dashboard':data or fixture['dashboard'],'health':health,'storage':storage or {}}
    page.evaluate('''payload=>{
      window.testStore=payload.storage;
      Object.defineProperty(window,'localStorage',{value:{getItem:key=>window.testStore[key]??null,setItem:(key,value)=>{window.testStore[key]=value;}}});
      window.fetch=async path=>{
        const body=path==='/api/health'?payload.health:path==='/api/investors'?{investors:payload.directory}:payload.dashboard;
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      };
    }''',payload)
    page.add_script_tag(content='(()=>{'+code+'})();')
    page.wait_for_function("document.getElementById('view').getAttribute('aria-busy')==='false'", timeout=5000)
    return page

def mark(page):
    page.evaluate("""()=>{const el=document.createElement('div');el.textContent='OFFLINE UI TEST · SYNTHETIC FILINGS, NOT INVESTMENT DATA';el.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:999;padding:5px;text-align:center;background:#181925;color:white;font:10px Arial';document.body.append(el);} """)

with sync_playwright() as p:
    args={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('FOLIO_BROWSER'):args['executable_path']=os.environ['FOLIO_BROWSER']
    browser=p.chromium.launch(**args)
    ctx=browser.new_context(viewport={'width':1440,'height':1000})
    page=mount(ctx)
    assert page.locator('.data-table tbody tr').count()==5
    assert page.locator('.plot-bar').count()==0
    check('missing configuration renders directory without charts or invented values')
    fits(page,'desktop empty state fits viewport')
    page.screenshot(path=str(OUT/'unconfigured-desktop.png'),full_page=True)
    page.locator('a[href="#sources"]').first.click()
    page.get_by_role('heading',name='Connect SEC access').wait_for()
    check('runtime configuration instructions reachable')
    page.locator('[data-view=investors]').click()
    page.get_by_role('button',name='Follow Warren Buffett',exact=True).click()
    store=page.evaluate('window.testStore')
    assert 'berkshire' in json.loads(store['folio.follows.v1'])
    page.close()
    page=mount(ctx,storage=store)
    page.locator('[data-view=investors]').click()
    page.get_by_role('button',name='Unfollow Warren Buffett',exact=True).wait_for()
    check('follow state rehydrates from the storage adapter')
    page.get_by_role('button',name='Switch to dark theme').click()
    assert page.locator('html').get_attribute('data-theme')=='dark'
    check('theme changes rendered tokens')
    for width in [390,320]:
        page.set_viewport_size({'width':width,'height':900})
        fits(page,f'{width}px empty state fits viewport')
        assert not page.locator('#navigation').is_visible()
        page.locator('#open-menu').click()
        assert page.locator('#navigation').is_visible()
        page.locator('#close-menu').click()
        assert not page.locator('#navigation').is_visible()
    check('mobile navigation hides closed controls')
    page.close()
    page=mount(ctx,configured=True)
    assert page.locator('.allocation-row').count()==8
    assert page.locator('.distribution-row').count()==5
    fits(page,'desktop chart layout fits viewport')
    check('eight allocation pairs and five quantity categories render')
    mark(page)
    page.screenshot(path=str(OUT/'synthetic-overview-desktop.png'),full_page=True)
    page.locator('[data-security="000000001"]').first.click()
    page.get_by_role('heading',name='Holdings & changes').wait_for()
    assert page.locator('#holding-search').input_value()=='000000001'
    assert page.locator('#holdings-results tbody tr').count()==3
    check('allocation click drills into filtered holdings')
    page.locator('#holding-search').fill('nothing matches')
    page.get_by_role('heading',name='No matching holdings').wait_for()
    page.locator('#holding-search').fill('')
    page.locator('#action-filter').select_option('EXITED')
    assert page.locator('#holdings-results tbody tr').count()==3
    page.locator('#sort').select_option('issuer')
    check('search and quantity filters update the table')
    page.locator('[data-view=overlap]').click()
    page.locator('.overlap-cell').first.wait_for()
    assert page.locator('.overlap-table tbody tr').count()==9
    check('same-quarter overlap matrix renders')
    page.screenshot(path=str(OUT/'synthetic-overlap-desktop.png'),full_page=True)
    page.locator('#manager').select_option('alpha')
    page.get_by_role('heading',name='Choose at least two managers').wait_for()
    check('single-manager overlap has an explicit empty state')
    page.get_by_role('button',name='Show all managers').click()
    page.locator('[data-view=overview]').click()
    page.locator('#following-only').check()
    page.get_by_role('heading',name='No reports match this view').wait_for()
    page.get_by_role('button',name='Reset filters').click()
    check('following-only zero coverage remains explicit')
    page.locator('[data-view=investors]').click()
    page.get_by_role('button',name='Follow Alpha Research',exact=True).click()
    page.locator('[data-view=overview]').click()
    page.locator('#following-only').check()
    assert page.locator('.metric strong').first.inner_text()=='1'
    check('following scope updates the metric and chart input')
    page.locator('#following-only').uncheck()
    for width in [390,320]:
        page.set_viewport_size({'width':width,'height':900})
        fits(page,f'{width}px charts fit viewport')
    page.screenshot(path=str(OUT/'synthetic-overview-mobile.png'),full_page=True)
    page.close()
    partial={**fixture['dashboard'],'investors':fixture['dashboard']['investors'][:2],'errors':[{'slug':'gamma','entity':'Gamma Test Fund','error':'Synthetic upstream failure'}]}
    page=mount(ctx,configured=True,data=partial)
    assert 'Partial filing coverage' in page.locator('#notice').inner_text()
    page.locator('[data-view=sources]').click()
    page.get_by_text('Synthetic upstream failure',exact=True).wait_for()
    check('partial coverage and source errors remain visible')
    assert not errors,errors
    check('no JavaScript page errors in offline checks')
    browser.close()
print(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'mode':'offline DOM; fetch and storage are test doubles'},indent=2))
