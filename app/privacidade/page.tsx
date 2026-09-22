import type { Metadata } from 'next';
import { LegalLayout, Section, CONTACT_EMAIL } from '@/app/components/LegalLayout';

export const metadata: Metadata = {
  title: 'Política de Privacidade — Autometrics',
  description: 'Como o Autometrics coleta, usa e protege os dados de quem usa a plataforma.',
};

export default function PrivacidadePage() {
  return (
    <LegalLayout title="Política de Privacidade">
      <p>
        O Autometrics (autometrics.cloud) é um painel de acompanhamento de campanhas de tráfego pago.
        Esta política explica quais dados a plataforma coleta, para que os usa e como você pode retirá-los.
        Dúvidas: <a className="text-indigo-400 hover:text-indigo-300" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <Section title="1. Dados que coletamos">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong className="text-white">Cadastro:</strong> e-mail e senha, ou o e-mail e o nome da conta Google usada para entrar.</li>
          <li><strong className="text-white">Google Ads:</strong> quando você conecta uma conta Google, lemos dados das campanhas às quais esse login tem acesso — nome, status, orçamento, impressões, cliques, custo, termos de pesquisa, públicos, localização e histórico de alterações. Também pausamos ou ativamos uma campanha quando você pede isso no painel.</li>
          <li><strong className="text-white">Conversões:</strong> eventos de venda, reembolso e estorno enviados pelas plataformas de pagamento e rastreadores que você configurar, além de cliques identificados por parâmetros de URL.</li>
          <li><strong className="text-white">Métricas de vídeo:</strong> dados de retenção da VTurb, se você informar o token dela.</li>
          <li><strong className="text-white">Dados técnicos:</strong> informações do navegador guardadas no seu próprio dispositivo para manter a sessão aberta e lembrar preferências como tema e filtros.</li>
        </ul>
      </Section>

      <Section title="2. Para que usamos">
        <p>
          Os dados servem para montar o painel: mostrar custo, receita, lucro e status de cada campanha,
          organizar o histórico e executar as ações que você comanda. Não usamos seus dados para publicidade
          própria, não fazemos perfis para terceiros e não vendemos nem alugamos informação nenhuma.
        </p>
      </Section>

      <Section title="3. Uso dos dados da Google Ads API">
        <p>
          O uso e a transferência de informações recebidas das APIs do Google pelo Autometrics seguem a{' '}
          <a className="text-indigo-400 hover:text-indigo-300" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Política de Dados do Usuário dos Serviços de API do Google
          </a>, inclusive os requisitos de Uso Limitado.
        </p>
        <p>
          Na prática: os dados do Google Ads aparecem só para a conta que autorizou a conexão, não são
          usados para treinar modelos, não são vendidos e não são repassados a terceiros, exceto quando
          você pedir ou a lei exigir.
        </p>
      </Section>

      <Section title="4. Com quem compartilhamos">
        <p>
          Apenas com os serviços necessários para a plataforma funcionar: o banco de dados e a autenticação
          (Supabase) e a hospedagem do site. Eles processam os dados em nosso nome e não podem usá-los para
          outra finalidade. Fora isso, só compartilhamos por ordem judicial ou obrigação legal.
        </p>
      </Section>

      <Section title="5. Segurança e prazo de guarda">
        <p>
          A autorização de acesso ao Google Ads é guardada criptografada e nunca é enviada ao navegador.
          Cada conta enxerga apenas os próprios registros, regra aplicada no próprio banco de dados.
        </p>
        <p>
          Os dados ficam guardados enquanto sua conta existir. Ao encerrar a conta, apagamos os dados em até
          30 dias, salvo o que precisarmos manter por obrigação legal.
        </p>
      </Section>

      <Section title="6. Seus direitos">
        <p>
          Você pode pedir acesso, correção, exportação ou exclusão dos seus dados pelo e-mail de contato,
          conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018). Respondemos em até 15 dias.
        </p>
        <p>
          A conexão com o Google pode ser desfeita a qualquer momento: em <strong className="text-white">Integração → Google Ads</strong>,
          clicando em desconectar, ou diretamente em{' '}
          <a className="text-indigo-400 hover:text-indigo-300" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>. A autorização é revogada na hora e a coleta para.
        </p>
      </Section>

      <Section title="7. Mudanças nesta política">
        <p>
          Se algo mudar, atualizamos esta página e a data no topo. Mudanças relevantes são avisadas por
          e-mail ou dentro do painel.
        </p>
      </Section>
    </LegalLayout>
  );
}
