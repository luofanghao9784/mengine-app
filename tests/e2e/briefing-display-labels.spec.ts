import {test,expect} from '@playwright/test';
test('平台标签用于卡面与详情，未知值保留，不把两种状态显示为期间',async({page})=>{
 await page.goto('/tests/fixtures/live-magazine/?labels');
 const card=page.locator('.live-briefing-tile');
 await expect(card).toContainText('开课中');await expect(card).toContainText('财务已确认');await expect(card).toContainText('已取消');await expect(card).toContainText('unknown_status');
 await expect(card.locator('.briefing-face')).toHaveClass(/is-pair/);
 await page.screenshot({path:'.local/briefing-face-alignment/labels-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'阅读：合成状态显示核对',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('开课中');await expect(dialog).toContainText('财务已确认');await expect(dialog).toContainText('unknown_status');
 await page.setViewportSize({width:390,height:844});
 await expect(dialog).toContainText('财务已确认');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'.local/briefing-face-alignment/labels-mobile.png',fullPage:true});
});
