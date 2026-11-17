import { useEffect } from "react";
import { OFFICE_DATA } from "../data/office";
export function PaymentReturn() {
  useEffect(() => {
    window.history.replaceState(null, "", "/pagamento/retorno");
  }, []);
  return (
    <main className="min-h-screen bg-ivory px-6 py-20 text-obsidian">
      <div className="mx-auto max-w-xl border-t-2 border-bronze pt-10">
        <p className="font-mono text-xs uppercase tracking-widest">
          M14 Advocacia
        </p>
        <h1 className="my-6 font-serif text-4xl">Retorno do pagamento</h1>
        <p className="leading-relaxed">
          O escritório acompanha a confirmação diretamente na InfinitePay. O
          retorno a esta página, por si só, não confirma o pagamento.
        </p>
        <p className="my-6">
          Se precisar conferir a situação, entre em contato com o escritório e
          tenha o comprovante em mãos.
        </p>
        <a
          className="block underline"
          href={`https://wa.me/${OFFICE_DATA.whatsappE164}`}
        >
          Falar com o escritório no WhatsApp
        </a>
        <a className="mt-6 inline-block underline" href="/">
          Voltar ao portal
        </a>
      </div>
    </main>
  );
}
