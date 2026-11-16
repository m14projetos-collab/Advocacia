import { expect, Page, test } from '@playwright/test';

async function widget(page: Page) {
  let scripts = 0;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', async route => {
    scripts++;
    await route.fulfill({ contentType:'application/javascript', body: `
      let sequence=0; const widgets=new Map();
      window.turnstile={
        render(container,options){
          const id='widget-'+(++sequence); widgets.set(id,container);
          if(options.sitekey!=='1x00000000000000000000AA'||options.action!=='leads_intake') throw Error('Wrong Turnstile options');
          for(const [label,callback] of [['Validar segurança',()=>options.callback('test-token-'+id)],['Expirar segurança',()=>options['expired-callback']()],['Falhar segurança',()=>options['error-callback']()]]){
            const button=document.createElement('button'); button.type='button'; button.textContent=label; button.onclick=callback; container.appendChild(button);
          }
          return id;
        },
        remove(id){widgets.get(id)?.replaceChildren();widgets.delete(id);}
      };
    ` });
  });
  return () => scripts;
}
async function fill(page: Page) {
  await page.goto('/');
  await page.getByLabel('Nome completo *', { exact:true }).fill('Cliente Teste');
  await page.getByLabel('WhatsApp com DDD *').fill('13999999999');
  await page.getByRole('button',{name:'Continuar para o resumo'}).click();
  await page.getByLabel('Resumo breve da situação *').fill('Gostaria de revisar um contrato de prestação de serviços.');
  await page.getByRole('checkbox',{name:/Concordo com o envio/}).check();
}

test('Turnstile bloqueia token ausente/expirado e renova token após falha no envio', async ({page}) => {
  const scriptCount = await widget(page);
  const bodies: Record<string,unknown>[]=[];
  await page.route('https://crm-test.supabase.co/functions/v1/leads-intake',async route=>{
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status:bodies.length===1?503:201, json:bodies.length===1?{error:'Tente novamente.'}:{ok:true} });
  });
  await fill(page);
  const submit=page.getByRole('button',{name:'Enviar Solicitação',exact:true});
  await expect(submit).toBeDisabled();
  await page.getByRole('button',{name:'Validar segurança',exact:true}).click();
  await expect(submit).toBeEnabled();
  await page.getByRole('button',{name:'Expirar segurança',exact:true}).click();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('expirou');
  expect(bodies).toHaveLength(0);
  await page.getByRole('button',{name:'Validar segurança',exact:true}).click();
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Tente novamente.');
  await expect(submit).toBeDisabled();
  await page.getByRole('button',{name:'Validar segurança',exact:true}).click();
  await submit.click();
  await expect(page.getByRole('heading',{name:'Solicitação registrada com sucesso'})).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({phone:'+5513999999999',lgpd_consent:true});
  expect(bodies[0].turnstile_token).toMatch(/^test-token-widget-/);
  expect(bodies[1].turnstile_token).not.toEqual(bodies[0].turnstile_token);
  expect(scriptCount()).toBe(1);
});

test('voltar ao primeiro passo remove widget e invalida o token anterior', async ({page})=>{
  await widget(page); await fill(page);
  await page.getByRole('button',{name:'Validar segurança',exact:true}).click();
  await page.getByRole('button',{name:'Voltar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Validar segurança',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Continuar para o resumo'}).click();
  await expect(page.getByRole('button',{name:'Validar segurança',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Enviar Solicitação',exact:true})).toBeDisabled();
});

test('erro de carregamento do CAPTCHA bloqueia envio e permite tentar novamente', async ({page})=>{
  let scripts=0;
  await page.route('https://challenges.cloudflare.com/**',route=>{scripts++;return route.abort();});
  await fill(page);
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar');
  await expect(page.getByRole('button',{name:'Enviar Solicitação',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Tentar verificação novamente'}).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar');
  await expect.poll(()=>scripts).toBe(2);
});
