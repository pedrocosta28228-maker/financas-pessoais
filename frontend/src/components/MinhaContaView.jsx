import { useEffect, useState } from 'react';
import { api, salvarToken } from '../api.js';
import { obterIniciais } from './PerfilDrawer.jsx';

const CORES_AVATAR = [
  '#0052d4', // Azul fintech
  '#16a34a', // Verde
  '#7c3aed', // Roxo
  '#0d9488', // Turquesa
  '#ea580c', // Laranja
  '#db2777', // Rosa
];

function formatarDataCadastro(valor) {
  if (!valor) return null;
  const iso = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function escaparCsv(texto) {
  const s = String(texto ?? '');
  if (/[;"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function baixarArquivo(conteudo, nomeArquivo, tipoMime) {
  const blob = new Blob([conteudo], { type: tipoMime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Tela "Minha conta": editar nome e cor do avatar, alterar senha com segurança
 * e baixar backup/planilha dos seus dados.
 */
export default function MinhaContaView({
  usuario,
  lancamentosTodos,
  contas,
  metas,
  despesasFixas,
  salarioConfig,
  onUsuarioAtualizado,
  onVoltar,
}) {
  // Dados do perfil
  const [nome, setNome] = useState(usuario.nome || '');
  const [avatarCor, setAvatarCor] = useState(usuario.avatarCor || CORES_AVATAR[0]);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [erroPerfil, setErroPerfil] = useState('');
  const [sucessoPerfil, setSucessoPerfil] = useState('');

  // Alterar senha
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mostrarSenhas, setMostrarSenhas] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState('');
  const [sucessoSenha, setSucessoSenha] = useState('');

  // Preferências de notificações por e-mail
  const [notifCarregando, setNotifCarregando] = useState(true);
  const [notifConfig, setNotifConfig] = useState({
    ativo: true,
    lembreteDia: true,
    lembreteVespera: false,
    resumoMensal: true,
    diasAntesSalario: 1,
  });
  const [emailServidorOk, setEmailServidorOk] = useState(true);
  const [diaSalarioNotif, setDiaSalarioNotif] = useState(
    salarioConfig?.dia_pagamento || null
  );
  const [proximoResumo, setProximoResumo] = useState(null);
  const [salvandoNotif, setSalvandoNotif] = useState(false);
  const [testandoTipo, setTestandoTipo] = useState('');
  const [erroNotif, setErroNotif] = useState('');
  const [sucessoNotif, setSucessoNotif] = useState('');

  const dataCadastro = formatarDataCadastro(usuario.criadoEm);

  useEffect(() => {
    let ativo = true;
    api
      .obterNotificacoesConfig()
      .then((resp) => {
        if (!ativo) return;
        if (resp?.config) setNotifConfig(resp.config);
        setEmailServidorOk(Boolean(resp?.emailConfigurado));
        setDiaSalarioNotif(resp?.diaSalario ?? salarioConfig?.dia_pagamento ?? null);
        setProximoResumo(resp?.proximoResumo || null);
      })
      .catch(() => {
        // Mantém padrões caso a busca inicial falhe
      })
      .finally(() => {
        if (ativo) setNotifCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [salarioConfig?.dia_pagamento]);

  async function handleSalvarNotificacoes(e) {
    e.preventDefault();
    setErroNotif('');
    setSucessoNotif('');
    setSalvandoNotif(true);
    try {
      const resp = await api.salvarNotificacoesConfig(notifConfig);
      if (resp?.config) setNotifConfig(resp.config);
      setProximoResumo(resp?.proximoResumo || null);
      setSucessoNotif('Preferências de lembretes salvas!');
    } catch (err) {
      setErroNotif(err.message);
    } finally {
      setSalvandoNotif(false);
    }
  }

  async function handleTestarEmail(tipo) {
    setErroNotif('');
    setSucessoNotif('');
    setTestandoTipo(tipo);
    try {
      const resp = await api.testarNotificacaoEmail(tipo);
      setSucessoNotif(resp.mensagem || 'E-mail de teste disparado!');
    } catch (err) {
      setErroNotif(err.message);
    } finally {
      setTestandoTipo('');
    }
  }

  async function handleSalvarPerfil(e) {
    e.preventDefault();
    setErroPerfil('');
    setSucessoPerfil('');
    setSalvandoPerfil(true);
    try {
      const resp = await api.atualizarPerfil({ nome, avatarCor });
      salvarToken(resp.token);
      onUsuarioAtualizado(resp.usuario);
      setSucessoPerfil('Perfil atualizado com sucesso!');
    } catch (err) {
      setErroPerfil(err.message);
    } finally {
      setSalvandoPerfil(false);
    }
  }

  async function handleAlterarSenha(e) {
    e.preventDefault();
    setErroSenha('');
    setSucessoSenha('');

    if (novaSenha !== confirmarSenha) {
      setErroSenha('A confirmação da nova senha não confere.');
      return;
    }

    setSalvandoSenha(true);
    try {
      const resp = await api.alterarSenha(senhaAtual, novaSenha);
      if (resp?.token) {
        salvarToken(resp.token);
      }
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmarSenha('');
      setSucessoSenha('Senha alterada com sucesso!');
    } catch (err) {
      setErroSenha(err.message);
    } finally {
      setSalvandoSenha(false);
    }
  }

  function handleExportarCsv() {
    const cabecalho = [
      'Data',
      'Tipo',
      'Título',
      'Categoria',
      'Carteira',
      'Cartão / Devo para',
      'Valor (R$)',
      'Status',
    ];
    const linhas = lancamentosTodos.map((item) => [
      item.data,
      item.tipo,
      item.titulo,
      item.categoria,
      item.conta_nome || '',
      item.origem_divida || '',
      String(item.valor).replace('.', ','),
      item.status,
    ]);

    const csv =
      '\uFEFF' +
      [cabecalho, ...linhas]
        .map((cols) => cols.map(escaparCsv).join(';'))
        .join('\r\n');

    const hoje = new Date().toISOString().slice(0, 10);
    baixarArquivo(csv, `minhas-financas-${hoje}.csv`, 'text/csv;charset=utf-8');
  }

  function handleBaixarBackupJson() {
    const backup = {
      exportadoEm: new Date().toISOString(),
      usuario: { nome: usuario.nome, email: usuario.email },
      salarioFixo: salarioConfig,
      carteiras: contas,
      metas,
      despesasFixas,
      lancamentos: lancamentosTodos,
    };
    const hoje = new Date().toISOString().slice(0, 10);
    baixarArquivo(
      JSON.stringify(backup, null, 2),
      `backup-financas-${hoje}.json`,
      'application/json;charset=utf-8'
    );
  }

  return (
    <div className="account-view">
      <div className="account-top-actions">
        <button type="button" className="btn-small" onClick={onVoltar}>
          ← Voltar para Visão Geral
        </button>
      </div>

      <div className="account-grid">
        {/* Card 1: Dados do Perfil */}
        <section className="panel account-card">
          <h2>Dados do perfil</h2>

          <div className="account-avatar-preview">
            <div
              className="avatar-circle large"
              style={{
                backgroundColor: avatarCor,
                boxShadow: `0 0 0 3px var(--surface), 0 0 0 5px ${avatarCor}55`,
              }}
            >
              {obterIniciais(nome || usuario.nome)}
            </div>
            <div>
              <strong>{nome || usuario.nome}</strong>
              <span className="account-email-muted">{usuario.email}</span>
              {dataCadastro && (
                <span className="account-since">Membro desde {dataCadastro}</span>
              )}
            </div>
          </div>

          <form onSubmit={handleSalvarPerfil} className="entry-form">
            <label className="field">
              <span>Nome</span>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                minLength={2}
                maxLength={80}
                required
              />
            </label>

            <label className="field">
              <span>E-mail</span>
              <input type="email" value={usuario.email} disabled />
            </label>

            <div className="field">
              <span>Cor do avatar</span>
              <div className="color-picker">
                {CORES_AVATAR.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={avatarCor === c ? 'color-dot active' : 'color-dot'}
                    style={{ backgroundColor: c }}
                    onClick={() => setAvatarCor(c)}
                    aria-label={`Cor ${c}`}
                  />
                ))}
              </div>
            </div>

            {erroPerfil && <div className="alert-error">{erroPerfil}</div>}
            {sucessoPerfil && <div className="alert-success">{sucessoPerfil}</div>}

            <button
              type="submit"
              className="btn-primary"
              disabled={salvandoPerfil}
            >
              {salvandoPerfil ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </form>
        </section>

        {/* Card 2: Segurança / Alterar senha */}
        <section className="panel account-card">
          <div className="panel-header">
            <h2>Segurança</h2>
            <button
              type="button"
              className="btn-link"
              onClick={() => setMostrarSenhas((v) => !v)}
            >
              {mostrarSenhas ? 'Ocultar senhas' : 'Mostrar senhas'}
            </button>
          </div>

          <form onSubmit={handleAlterarSenha} className="entry-form">
            <label className="field">
              <span>Senha atual</span>
              <input
                type={mostrarSenhas ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Digite sua senha atual"
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Nova senha</span>
              <input
                type={mostrarSenhas ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Mínimo 6 caracteres"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                minLength={6}
                maxLength={128}
                required
              />
            </label>

            <label className="field">
              <span>Confirmar nova senha</span>
              <input
                type={mostrarSenhas ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Repita a nova senha"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                minLength={6}
                maxLength={128}
                required
              />
            </label>

            {erroSenha && <div className="alert-error">{erroSenha}</div>}
            {sucessoSenha && <div className="alert-success">{sucessoSenha}</div>}

            <button
              type="submit"
              className="btn-primary"
              disabled={salvandoSenha}
            >
              {salvandoSenha ? 'Atualizando...' : 'Alterar senha'}
            </button>
          </form>
        </section>
      </div>

      {/* Card 3: Lembretes e Resumo por E-mail */}
      <section className="panel notif-panel">
        <div className="notif-header">
          <div>
            <div className="notif-title-row">
              <h2>Lembretes por e-mail</h2>
              <span
                className={
                  notifConfig.ativo ? 'notif-status-pill ativo' : 'notif-status-pill pausado'
                }
              >
                {notifConfig.ativo ? 'Ativos' : 'Pausados'}
              </span>
            </div>
            <p className="chart-subtitle">
              Enviados para <strong>{usuario.email}</strong> às 08h (horário de Brasília).
            </p>
          </div>

          <label className="notif-master-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={notifConfig.ativo}
              disabled={notifCarregando}
              onChange={(e) =>
                setNotifConfig((prev) => ({ ...prev, ativo: e.target.checked }))
              }
            />
            <span className="notif-switch-track" aria-hidden="true" />
            <span className="notif-master-label">
              {notifConfig.ativo ? 'Ligado' : 'Desligado'}
            </span>
          </label>
        </div>

        <form onSubmit={handleSalvarNotificacoes} className="notif-form">
          <div className={notifConfig.ativo ? 'notif-options' : 'notif-options disabled'}>
            <label className="notif-option-row">
              <div className="notif-option-text">
                <strong>Aviso no dia do vencimento (08h)</strong>
                <span>
                  Envia a lista de dívidas e despesas fixas que vencem hoje, com valor e para quem pagar.
                </span>
              </div>
              <input
                type="checkbox"
                role="switch"
                className="notif-checkbox-switch"
                disabled={!notifConfig.ativo || notifCarregando}
                checked={notifConfig.lembreteDia}
                onChange={(e) =>
                  setNotifConfig((prev) => ({ ...prev, lembreteDia: e.target.checked }))
                }
              />
            </label>

            <label className="notif-option-row">
              <div className="notif-option-text">
                <strong>Aviso antecipado na véspera (1 dia antes)</strong>
                <span>
                  Receba um lembrete um dia antes do vencimento para já deixar o valor separado.
                </span>
              </div>
              <input
                type="checkbox"
                role="switch"
                className="notif-checkbox-switch"
                disabled={!notifConfig.ativo || notifCarregando}
                checked={notifConfig.lembreteVespera}
                onChange={(e) =>
                  setNotifConfig((prev) => ({ ...prev, lembreteVespera: e.target.checked }))
                }
              />
            </label>

            <div className="notif-option-row column">
              <label className="notif-option-row-inner">
                <div className="notif-option-text">
                  <strong>Resumo mensal das contas previstas</strong>
                  <span>
                    {diaSalarioNotif
                      ? `Lista todas as contas do mês perto do dia do seu salário (dia ${diaSalarioNotif}).`
                      : 'Sem salário fixo cadastrado — enviamos todo dia 1 do mês com todas as contas previstas.'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  role="switch"
                  className="notif-checkbox-switch"
                  disabled={!notifConfig.ativo || notifCarregando}
                  checked={notifConfig.resumoMensal}
                  onChange={(e) =>
                    setNotifConfig((prev) => ({ ...prev, resumoMensal: e.target.checked }))
                  }
                />
              </label>

              {notifConfig.ativo && notifConfig.resumoMensal && (
                <div className="notif-subconfig">
                  {diaSalarioNotif ? (
                    <label className="notif-inline-select">
                      <span>Quando enviar:</span>
                      <select
                        value={notifConfig.diasAntesSalario}
                        onChange={(e) =>
                          setNotifConfig((prev) => ({
                            ...prev,
                            diasAntesSalario: Number(e.target.value),
                          }))
                        }
                      >
                        <option value={0}>No dia do salário (dia {diaSalarioNotif})</option>
                        <option value={1}>1 dia antes do salário</option>
                        <option value={2}>2 dias antes do salário</option>
                        <option value={3}>3 dias antes do salário</option>
                        <option value={5}>5 dias antes do salário</option>
                      </select>
                    </label>
                  ) : null}

                  {proximoResumo?.dataDisparoIso && (
                    <span className="notif-next-pill">
                      Próximo resumo: {formatarDataCadastro(proximoResumo.dataDisparoIso)} (
                      {proximoResumo.nomeMes})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {!emailServidorOk && (
            <div className="notif-hint-box">
              O servidor ainda não está com a chave da <strong>Brevo</strong> ativa. No modo local,
              os testes aparecem no terminal do servidor; no site online, basta configurar{' '}
              <code>BREVO_API_KEY</code> e <code>EMAIL_REMETENTE</code> no Render.
            </div>
          )}

          {erroNotif && <div className="alert-error">{erroNotif}</div>}
          {sucessoNotif && <div className="alert-success">{sucessoNotif}</div>}

          <div className="notif-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={salvandoNotif || notifCarregando}
            >
              {salvandoNotif ? 'Salvando...' : 'Salvar preferências'}
            </button>

            <div className="notif-test-buttons">
              <button
                type="button"
                className="btn-outline"
                disabled={Boolean(testandoTipo)}
                onClick={() => handleTestarEmail('vencimento')}
              >
                {testandoTipo === 'vencimento' ? 'Enviando...' : 'Testar aviso do dia'}
              </button>
              <button
                type="button"
                className="btn-outline"
                disabled={Boolean(testandoTipo)}
                onClick={() => handleTestarEmail('resumo')}
              >
                {testandoTipo === 'resumo' ? 'Enviando...' : 'Testar resumo do mês'}
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* Card 4: Exportação e Backup */}
      <section className="panel backup-panel">
        <div className="backup-info">
          <h2>Seus dados e backup</h2>
          <p className="chart-subtitle">
            Exporte seus lançamentos para abrir no Excel ou baixe uma cópia completa dos seus dados.
          </p>
        </div>

        <div className="backup-actions">
          <button
            type="button"
            className="btn-outline"
            onClick={handleExportarCsv}
          >
            Exportar planilha (CSV)
          </button>
          <button
            type="button"
            className="btn-small-primary"
            onClick={handleBaixarBackupJson}
          >
            Baixar backup (JSON)
          </button>
        </div>
      </section>
    </div>
  );
}
