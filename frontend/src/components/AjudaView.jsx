const TOPICOS_AJUDA = [
  {
    titulo: 'Visão Geral e Calendário',
    cor: '#0052d4',
    itens: [
      'Use Geral para ver todo o dinheiro acumulado hoje, ou Por mês para inspecionar um mês específico.',
      'No calendário do mês, passe o mouse ou clique em qualquer dia para ver o que entrou e saiu — e marcar contas como pagas ali mesmo.',
    ],
  },
  {
    titulo: 'Entradas e Carteiras',
    cor: '#16a34a',
    itens: [
      'Cadastre suas carteiras (ex.: Uso diário, Cofrinho, RecargaPay) e informe quanto cada uma rende.',
      'Use o botão Transferir para mover dinheiro entre carteiras sem alterar o seu Saldo Total.',
    ],
  },
  {
    titulo: 'Salário Fixo',
    cor: '#3b82f6',
    itens: [
      'Clique em Registrar salário no topo para informar valor e dia do pagamento.',
      'No dia que cair, clique em Receber salário — você pode ajustar o valor se tiver hora extra naquele mês.',
    ],
  },
  {
    titulo: 'Dívidas e Parcelamentos',
    cor: '#d97706',
    itens: [
      'Ao criar uma dívida parcelada (ex.: 12x), o sistema cria todas as parcelas agrupadas e marca os vencimentos no calendário.',
      'Ao clicar em Pagar, escolha se o valor sai do seu saldo hoje ou se foi pago por fora — e use Desfazer se errar.',
    ],
  },
  {
    titulo: 'Saídas e Despesas Fixas',
    cor: '#dc2626',
    itens: [
      'Cadastre contas que se repetem todo mês (internet, academia, streaming) em Despesas fixas.',
      'Elas entram automaticamente na projeção de 12 meses e podem ser lançadas no mês atual com 1 clique.',
    ],
  },
  {
    titulo: 'Estatísticas e Metas',
    cor: '#7c3aed',
    itens: [
      'Na aba Estatísticas, acompanhe a projeção do seu saldo pelos próximos 12 meses e em qual mês você quita todas as dívidas.',
      'Em Metas, acompanhe objetivos por aportes manuais ou sincronizados diretamente ao saldo de uma carteira.',
    ],
  },
  {
    titulo: 'Usar no Celular (App)',
    cor: '#0d9488',
    itens: [
      'No Android (Chrome): abra o menu ⋮ e toque em "Instalar aplicativo" ou "Adicionar à tela inicial".',
      'No iPhone (Safari): toque em Compartilhar (↑) e escolha "Adicionar à Tela de Início".',
    ],
  },
  {
    titulo: 'Privacidade e Segurança',
    cor: '#64748b',
    itens: [
      'Sua senha é protegida com criptografia forte (scrypt) e cada conta enxerga exclusivamente os próprios dados.',
      'Em Minha conta você pode alterar sua senha e exportar um backup completo sempre que quiser.',
    ],
  },
];

/**
 * Tela "Ajuda": guia rápido e visual de como usar cada recurso do Minhas Finanças.
 */
export default function AjudaView({ onVoltar }) {
  return (
    <div className="help-view">
      <div className="account-top-actions">
        <button type="button" className="btn-small" onClick={onVoltar}>
          ← Voltar para Visão Geral
        </button>
      </div>

      <section className="help-grid">
        {TOPICOS_AJUDA.map((topico) => (
          <article
            key={topico.titulo}
            className="panel help-card"
            style={{ borderTopColor: topico.cor }}
          >
            <h3>{topico.titulo}</h3>
            <ul>
              {topico.itens.map((texto) => (
                <li key={texto}>{texto}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}
