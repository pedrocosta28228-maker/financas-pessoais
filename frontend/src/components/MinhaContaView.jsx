import { useState } from 'react';
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

  const dataCadastro = formatarDataCadastro(usuario.criadoEm);

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
      await api.alterarSenha(senhaAtual, novaSenha);
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

      {/* Card 3: Exportação e Backup */}
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
