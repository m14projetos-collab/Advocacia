export type PracticeAreaKey =
  | 'familia_sucessoes'
  | 'medico_saude'
  | 'criminal'
  | 'contratos'
  | 'outros';

export interface PracticeAreaItem {
  id: PracticeAreaKey;
  title: string;
  subtitle: string;
  description: string;
  topics: string[];
}

export const OFFICE_DATA = {
  name: 'Matheus Moraes',
  firmName: 'Matheus Moraes — Advocacia e Assessoria Jurídica',
  legalEntity: 'MATHEUS MORAES SOCIEDADE INDIVIDUAL DE ADVOCACIA',
  cnpj: '62.575.046/0001-96',
  oabNumber: import.meta.env.VITE_OFFICE_OAB_NUMBER || '',
  phoneDisplay: '(13) 99676-4688',
  whatsappE164: '5513996764688',
  email: 'matheusmoraesadvogado@gmail.com',
  address: 'Av. Conselheiro Nébias, 756, cj. 2421 — Helbor Offices, Vila Rica, Santos/SP',
  profilePhoto: 'https://matheusmoraes.startdigital1.com.br/wp-content/uploads/2025/09/5-683x1024.jpg',
  logoUrl: 'https://matheusmoraes.startdigital1.com.br/wp-content/uploads/2025/08/logo.png',
};

export const PRACTICE_AREAS: PracticeAreaItem[] = [
  {
    id: 'familia_sucessoes',
    title: 'Direito de Família e Sucessões',
    subtitle: 'Atuação principal · Santos e todo o Brasil',
    description:
      'Condução técnica e acolhedora em demandas familiares de alta sensibilidade, priorizando proteção patrimonial e estabilidade emocional.',
    topics: [
      'Ação, revisão e execução de alimentos (inclusive alimentos gravídicos)',
      'Guarda, convivência e regulamentação de visitas',
      'Divórcio judicial ou extrajudicial e união estável',
      'Inventário, arrolamento de bens e alteração de regime de bens',
      'Investigação/negatória de paternidade, interdição e medidas protetivas',
    ],
  },
  {
    id: 'medico_saude',
    title: 'Direito Médico e da Saúde',
    subtitle: 'Pacientes e profissionais da saúde',
    description:
      'Assessoria jurídica célere para garantia de tratamentos essenciais junto a operadoras e defesa técnica de profissionais médicos.',
    topics: [
      'Pedidos liminares para cirurgias, exames e medicamentos de alto custo',
      'Negativas indevidas de cobertura por planos de saúde',
      'Defesa profissional em sindicâncias e processos ético-disciplinares',
      'Responsabilidade civil médica e elaboração de termos de consentimento',
    ],
  },
  {
    id: 'criminal',
    title: 'Prática Criminal',
    subtitle: 'Defesa técnica e acompanhamento processual',
    description:
      'Atuação estratégica em inquéritos policiais, audiências de custódia e ações penais com acompanhamento rigoroso de garantias.',
    topics: [
      'Defesa em processos criminais e recursos',
      'Acompanhamento em delegacias e audiências de custódia',
      'Pedidos de liberdade provisória e medidas cautelares',
      'Atuação em medidas protetivas e crimes contra a honra',
    ],
  },
  {
    id: 'contratos',
    title: 'Direito dos Contratos & Público',
    subtitle: 'Prevenção de litígios e segurança jurídica',
    description:
      'Elaboração, revisão e análise de riscos contratuais para pessoas físicas, clínicas e empresas, além de demandas em Direito Público.',
    topics: [
      'Revisão e elaboração de contratos civis e empresariais',
      'Notificações extrajudiciais e resolução de inadimplemento',
      'Assessoria jurídica preventiva para profissionais liberais',
      'Consultoria em Direito Público Aplicado',
    ],
  },
];
