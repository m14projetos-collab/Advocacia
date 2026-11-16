import { expect, test } from '@playwright/test';

test('intake desabilitado ou sem chave oferece WhatsApp sem carregar CAPTCHA nem enviar dados',async({page})=>{
  const requests:string[]=[];
  page.on('request',request=>{
    if(request.url().includes('challenges.cloudflare.com')||request.url().includes('/functions/v1/leads-intake')) requests.push(request.url());
  });
  await page.goto('/');
  const section=page.locator('#triagem');
  await expect(section.getByRole('heading',{name:'Atendimento pelo WhatsApp'})).toBeVisible();
  await expect(section.getByRole('link',{name:'Falar com o escritório no WhatsApp'})).toHaveAttribute('href',/^https:\/\/wa.me\//);
  await expect(section.locator('form')).toHaveCount(0);
  expect(requests).toEqual([]);
});
