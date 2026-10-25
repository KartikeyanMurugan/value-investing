import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        for name, w, h in [('desktop', 1280, 820), ('mobile', 390, 844)]:
            pg = await b.new_page(viewport={'width': w, 'height': h})
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://localhost:8765/')
            await pg.wait_for_timeout(800)
            await pg.click('[data-tab=all]')
            await pg.screenshot(path=f'tests/{name}_all.png', full_page=True)
            await pg.click('.row[data-s=DEMOTECH]')
            await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'tests/{name}_detail.png', full_page=False)
            await pg.close()
        print('errors:', errs)
        await b.close()
asyncio.run(main())
