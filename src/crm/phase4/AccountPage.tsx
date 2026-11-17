import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { message } from "../types";
interface Profile {
  full_name: string;
  role: string;
  is_active: boolean;
  oab_number: string | null;
  phone: string | null;
  bio: string | null;
}
export function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [current, setCurrent] = useState("");
  const [nonce, setNonce] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase!.auth.getUser();
        if (userError || !user)
          throw new Error("Entre novamente para visualizar sua conta.");
        const { data, error: profileError } = await supabase!
          .from("profiles")
          .select("full_name,role,is_active,oab_number,phone,bio")
          .eq("id", user.id)
          .single();
        if (profileError) throw profileError;
        if (alive) {
          setProfile(data as Profile);
          setEmail(user.email ?? "");
        }
      } catch (err) {
        if (alive) setError(message(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  async function change(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (password.length < 8) {
      setError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("A confirmação não corresponde à nova senha.");
      return;
    }
    setBusy(true);
    try {
      const { error: authError } = await supabase!.auth.updateUser({
        password,
        ...(current ? { current_password: current } : {}),
        ...(nonce ? { nonce } : {}),
      });
      if (authError) {
        if (
          ["reauthentication_needed", "reauthentication_not_valid"].includes(
            authError.code ?? "",
          )
        )
          throw new Error(
            "Reautenticação necessária. Solicite o código e informe o código recebido por e-mail.",
          );
        if (authError.code === "weak_password")
          throw new Error(
            "A nova senha foi recusada pela política de segurança. Use uma senha mais forte e diferente de senhas conhecidas.",
          );
        if (authError.code === "same_password")
          throw new Error("Escolha uma senha diferente da atual.");
        throw authError;
      }
      setPassword("");
      setConfirm("");
      setCurrent("");
      setNonce("");
      setNotice(
        "Senha alterada com sucesso. Use a nova senha no próximo acesso.",
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function reauthenticate() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: authError } = await supabase!.auth.reauthenticate();
      if (authError) throw authError;
      setNotice(
        "Código solicitado. Confira seu e-mail e informe o código de segurança.",
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p role="status">Carregando sua conta…</p>;
  return (
    <section className="crm-account">
      {profile && (
        <>
          <p className="crm-eyebrow">Perfil do escritório</p>
          <h2>{profile.full_name}</h2>
          <dl className="crm-profile">
            <dt>E-mail</dt>
            <dd>{email || "Não informado"}</dd>
            <dt>Função</dt>
            <dd>{profile.role === "admin" ? "Administrador" : "Equipe"}</dd>
            <dt>Acesso</dt>
            <dd>{profile.is_active ? "Ativo" : "Inativo"}</dd>
            <dt>OAB</dt>
            <dd>{profile.oab_number || "Não informada"}</dd>
            <dt>Telefone</dt>
            <dd>{profile.phone || "Não informado"}</dd>
          </dl>
          {profile.bio && <p>{profile.bio}</p>}
        </>
      )}
      <form onSubmit={change} className="crm-stack" noValidate>
        <h2>Alterar minha senha</h2>
        <p className="crm-muted">
          A senha definitiva deve ter pelo menos 8 caracteres. As regras
          adicionais de segurança do escritório também serão verificadas pelo
          Supabase.
        </p>
        <label>
          Nova senha
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirmar nova senha
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            disabled={busy}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <details>
          <summary>Reautenticação e senha atual</summary>
          <p className="crm-muted">
            Preencha se a política do escritório solicitar uma verificação
            adicional.
          </p>
          <label>
            Senha atual
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              disabled={busy}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void reauthenticate()}
          >
            Solicitar código de segurança
          </button>
          <label>
            Código de segurança
            <input
              autoComplete="one-time-code"
              value={nonce}
              disabled={busy}
              onChange={(e) => setNonce(e.target.value)}
            />
          </label>
        </details>
        <button className="crm-primary" disabled={busy || !profile}>
          {busy ? "Processando…" : "Salvar nova senha"}
        </button>
      </form>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="crm-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
