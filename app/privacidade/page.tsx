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
        O Autometrics (autometrics.cloud) é um painel de acompanhamento e gestão de campanhas de tráfego pago.
        Esta política explica quais dados a plataforma coleta, para que os usa e como você pode retirá-los.
        Dúvidas: <a className="text-indigo-400 hover:text-indigo-300" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <Section title="1. Dados que coletamos">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong className="text-white">Cadastro:</strong> e-mail e senha, ou o e-mail e o nome da conta Google usada para entrar.</li>
          <li><strong className="text-white">Google Ads:</strong> quando você conecta uma conta Google, lemos dados das campanhas às quais esse login tem acesso — nome, status, orçamento, impressões, cliques, custo, termos de pesquisa, públicos, localização, anúncios e histórico de alterações. Também alteramos a conta quando você pede isso no painel — veja a seção 3.</li>
          <li><strong className="text-white">Conversões:</strong> eventos de venda, reembolso e estorno enviados pelas plataformas de pagamento e rastreadores que você configurar, além de cliques identificados por parâmetros de URL.</li>
          <li><strong className="text-white">Visitas às suas páginas:</strong> se você instalar o script de rastreamento do Autometrics nas suas páginas, registramos cada visita vinda dos anúncios — endereço IP, país, estado e cidade aproximados, aparelho, navegador, palavra-chave, identificador do clique do Google (gclid), tempo na página e rolagem. A localização é calculada no nosso servidor; o IP não é enviado a outro serviço.</li>
          <li><strong className="text-white">Métricas de vídeo:</strong> dados de retenção da VTurb, se você informar o token dela.</li>
          <li><strong className="text-white">Dados técnicos:</strong> informações do navegador guardadas no seu próprio dispositivo para manter a sessão aberta e lembrar preferências como tema e filtros.</li>
        </ul>
      </Section>

      <Section title="2. Para que usamos">
        <p>
          Os dados servem para montar o painel: mostrar custo, receita, lucro e status de cada campanha,
          organizar o histórico, gerar análises e sugestões e executar as ações que você comanda. Não usamos seus dados para publicidade
          própria, não fazemos perfis para terceiros e não vendemos nem alugamos informação nenhuma.
        </p>
      </Section>

      <Section title="3. Uso dos dados do Google">
        <p>
          O uso e a transferência de informações recebidas das APIs do Google pelo Autometrics seguem a{' '}
          <a className="text-indigo-400 hover:text-indigo-300" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Política de Dados do Usuário dos Serviços de API do Google
          </a>, inclusive os requisitos de Uso Limitado.
        </p>
        <p>Ao conectar uma conta Google, o Autometrics pede até duas permissões:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-white">Gerenciar suas campanhas do Google Ads.</strong> Usamos para ler os dados
            das campanhas e mostrá-los no painel, e para fazer na sua conta as alterações que você comandar:
            pausar ou ativar campanhas e palavras-chave, incluir palavras-chave negativas, mudar ajustes de lance
            e metas de CPA, e criar campanhas novas de Pesquisa, sempre pausadas, a partir do rascunho que você
            montar e confirmar. Nenhuma alteração é feita sem um comando seu no painel.
          </li>
          <li>
            <strong className="text-white">Enviar vendas ao Google.</strong> Pedida só se você ligar o envio de
            vendas. Usamos para enviar à sua própria conta do Google Ads as vendas recebidas da sua plataforma de
            pagamento, ligadas ao clique do anúncio que as originou (gclid), com data, valor, moeda e número do pedido. Não lemos
            nem alteramos mais nada com essa permissão.
          </li>
        </ul>
        <p>
          Os dados do Google Ads aparecem só para a conta que autorizou a conexão, não são vendidos, não são
          usados para publicidade e não são usados para treinar modelos de inteligência artificial. Só saem do
          Autometrics nos casos da seção 4, para entregar uma função que você usa, ou quando a lei exigir.
          Ninguém da equipe lê esses dados, a não ser com a sua autorização, para resolver um problema que você
          relatar, por segurança ou por obrigação legal.
        </p>
      </Section>

      <Section title="4. Com quem compartilhamos">
        <p>Apenas com os serviços necessários para a plataforma funcionar:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong className="text-white">Banco de dados, autenticação e hospedagem</strong> (Supabase e a hospedagem do site): guardam e processam os dados em nosso nome e não podem usá-los para outra finalidade.</li>
          <li><strong className="text-white">Análises por inteligência artificial:</strong> quando você usa as análises, as sugestões, as perguntas à IA ou a escrita de anúncios, os números e os textos da campanha analisada (nome, palavras-chave, termos de pesquisa, anúncios e métricas) são enviados a um serviço de inteligência artificial (OpenRouter e o modelo escolhido por ele) só para gerar a resposta. Seu e-mail, sua senha e a autorização do Google nunca são enviados.</li>
          <li><strong className="text-white">Telegram:</strong> se você ligar os alertas, o texto de cada alerta (nome da campanha e os números do aviso) é enviado ao Telegram para chegar até você.</li>
          <li><strong className="text-white">Google:</strong> as alterações que você comandar e, se ligado, as vendas descritas na seção 3 vão para a sua própria conta do Google Ads.</li>
        </ul>
        <p>
          Para melhorar as sugestões, guardamos o resultado de cada sugestão já avaliada apenas como contagem por
          tipo de situação, sem nome de campanha, palavra-chave, conta ou usuário.
        </p>
        <p>Fora isso, só compartilhamos por ordem judicial ou obrigação legal.</p>
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
          </a>. A autorização é revogada na hora; a coleta, as alterações e o envio de vendas param.
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
