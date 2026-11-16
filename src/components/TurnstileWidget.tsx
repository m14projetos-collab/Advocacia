import { useEffect, useRef, useState } from 'react';

type Options = {
  sitekey: string; theme: 'dark'; size: 'flexible'; action: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
  'timeout-callback': () => void;
  'response-field': boolean;
};
interface TurnstileApi {
  render: (container: HTMLElement, options: Options) => string;
  remove: (id: string) => void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let apiPromise: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.defer = true;
    const timer = setTimeout(() => fail(), 15_000);
    function fail() {
      clearTimeout(timer); script.remove(); apiPromise = null;
      reject(new Error('Não foi possível carregar a verificação de segurança.'));
    }
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile); else fail();
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

// O pai remonta este componente após cada tentativa de envio; tokens são de uso único.
export function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    callback.current(''); setError('');
    function invalidate(text: string) {
      if (!disposed) { callback.current(''); setError(text); }
    }
    void loadTurnstile().then(loaded => {
      if (disposed || !container.current) return;
      api = loaded;
      widget = loaded.render(container.current, {
        sitekey: siteKey, theme: 'dark', size: 'flexible', action: 'leads_intake', 'response-field': false,
        callback: token => { if (!disposed) { callback.current(token); setError(''); } },
        'expired-callback': () => invalidate('A verificação expirou. Verifique novamente antes de enviar.'),
        'error-callback': () => invalidate('Falha na verificação de segurança. Tente novamente ou utilize o WhatsApp.'),
        'timeout-callback': () => invalidate('A verificação não foi concluída. Tente novamente.'),
      });
    }).catch(() => invalidate('Não foi possível carregar a verificação de segurança. Tente novamente ou utilize o WhatsApp.'));
    return () => { disposed = true; if (widget !== undefined) api?.remove(widget); callback.current(''); };
  }, [siteKey, attempt]);
  return <div className="space-y-3">
    <div ref={container} aria-label="Verificação de segurança Cloudflare Turnstile" />
    {error && <><p role="alert" className="text-xs text-rose-200">{error}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)} className="text-xs text-ivory underline">Tentar verificação novamente</button></>}
  </div>;
}
