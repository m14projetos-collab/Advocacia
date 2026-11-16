import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { message } from './types';

export function AuthGate({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const login = window.location.pathname === '/crm/login';

  useEffect(() => {
    const db = supabase;
    if (!db) { setChecking(false); return; }
    let alive = true;
    let version = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    async function verify() {
      const current = ++version;
      try {
        const { data: { user }, error: userError } = await db!.auth.getUser();
        if (!alive || current !== version) return;
        if (userError || !user) { setActive(false); setChecking(false); return; }
        const { data, error: profileError } = await db!.from('profiles').select('id,is_active')
          .eq('id', user.id).eq('is_active', true).maybeSingle();
        if (!alive || current !== version) return;
        if (profileError || !data) {
          setActive(false);
          setError('Seu usuário não possui um perfil ativo no escritório. Solicite acesso ao administrador.');
          await db!.auth.signOut({ scope: 'local' });
        } else { setActive(true); setError(''); }
      } catch {
        if (alive && current === version) { setActive(false); setError('Não foi possível verificar seu acesso. Tente entrar novamente.'); }
      } finally { if (alive && current === version) setChecking(false); }
    }
    // Não aguardar chamadas Supabase dentro do callback de Auth (lock da sessão).
    const { data: { subscription } } = db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { ++version; setActive(false); setChecking(false); }
      else {
        const timer = setTimeout(() => { timers.delete(timer); void verify(); }, 0);
        timers.add(timer);
      }
    });
    void verify();
    const focus = () => { void verify(); };
    window.addEventListener('focus', focus);
    const interval = setInterval(focus, 60_000);
    return () => { alive = false; ++version; subscription.unsubscribe(); timers.forEach(clearTimeout); clearInterval(interval); window.removeEventListener('focus', focus); };
  }, []);

  useEffect(() => {
    if (active && login) window.location.replace('/crm');
    else if (!checking && !active && !login) window.history.replaceState(null, '', '/crm/login');
  }, [active, checking, login]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: String(form.get('email')).trim(), password: String(form.get('password')),
      });
      if (authError) setError('E-mail ou senha inválidos, ou acesso indisponível.');
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  if (checking) return <div className="crm-login" role="status">Verificando acesso ao escritório…</div>;
  if (active && !login) return <>{children}</>;
  return <main className="crm-login">
    <div className="crm-login-card">
      <a href="/" className="crm-brand">M14 <span>ADVOCACIA</span></a>
      <p className="crm-eyebrow">Área restrita · Santos / SP</p>
      <h1>Acesso ao escritório</h1>
      <p>Organização do atendimento, clientes e casos sob sigilo profissional.</p>
      {!supabase ? <p role="alert">Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para habilitar o acesso.</p> :
        <form onSubmit={signIn}>
          <label>E-mail profissional<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className="crm-error" role="alert">{error}</p>}
          <button className="crm-primary" disabled={busy}>{busy ? 'Verificando…' : 'Entrar no CRM'}</button>
        </form>}
      <a href="/">Voltar ao portal público</a>
    </div>
  </main>;
}
