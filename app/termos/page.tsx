import type { Metadata } from 'next';
import { LegalLayout, Section, CONTACT_EMAIL } from '@/app/components/LegalLayout';

export const metadata: Metadata = {
  title: 'Termos de Uso — Autometrics',
  description: 'Regras de uso da plataforma Autometrics.',
};

export default function TermosPage() {
  return (
    <LegalLayout title="Termos de Uso">
      <p>
        Estes termos valem para quem usa o Autometrics (autometrics.cloud). Ao criar uma conta ou conectar
        uma conta do Google Ads, você concorda com eles. Dúvidas:{' '}
        <a className="text-indigo-400 hover:text-indigo-300" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <Section title="1. O que a plataforma faz">
        <p>
          O Autometrics reúne, num painel, os dados das suas campanhas de tráfego pago e das suas vendas,
          calcula custo, receita e lucro, e permite pausar ou ativar campanhas conectadas. É uma ferramenta
          de acompanhamento: ela não gerencia seu investimento nem decide nada por você.
        </p>
      </Section>

      <Section title="2. Sua conta">
        <p>
          Você é responsável por guardar suas credenciais e por tudo que acontecer na sua conta. Avise-nos
          assim que suspeitar de acesso indevido. Não é permitido compartilhar o acesso com quem não deveria
          ver os dados das suas campanhas.
        </p>
      </Section>

      <Section title="3. Conexão com o Google Ads">
        <p>
          Ao conectar, você autoriza a plataforma a ler os dados das contas a que esse login do Google tem
          acesso e a alterar essas contas quando você comandar no painel: pausar ou ativar campanhas e
          palavras-chave, incluir palavras-chave negativas, mudar ajustes de lance e metas de CPA, criar
          campanhas novas (sempre pausadas) e, se você ligar, enviar suas vendas ao Google Ads.
        </p>
        <p>
          <strong className="text-white">Toda alteração vale na hora, na conta real do Google Ads.</strong>{' '}
          Confira antes de confirmar. Cada ação fica registrada com data, hora e resultado.
        </p>
        <p>
          Você continua sujeito às políticas do Google Ads. Conta suspensa, campanha reprovada ou limite de
          consultas da API do Google são situações fora do nosso controle.
        </p>
      </Section>

      <Section title="4. Uso aceitável">
        <p>
          Não use a plataforma para acessar dados de terceiros sem autorização, para burlar limites técnicos,
          nem para qualquer atividade ilegal. Podemos suspender contas que descumprirem esta regra.
        </p>
      </Section>

      <Section title="5. Disponibilidade">
        <p>
          Trabalhamos para manter o serviço no ar, mas ele pode ficar indisponível por manutenção, falha de
          terceiros (Google, Supabase, hospedagem) ou motivo de força maior. Os dados exibidos dependem do
          que essas plataformas informam e podem ser corrigidos por elas depois — o custo do Google Ads, por
          exemplo, muda quando cliques inválidos são estornados.
        </p>
      </Section>

      <Section title="6. Limites de responsabilidade">
        <p>
          As decisões sobre suas campanhas são suas. Não respondemos por prejuízo decorrente de decisão
          tomada com base nos números exibidos, de indisponibilidade do serviço ou de erro em dados
          fornecidos por terceiros. Nossa responsabilidade, em qualquer caso, fica limitada ao valor pago
          pelo serviço nos 12 meses anteriores ao fato.
        </p>
      </Section>

      <Section title="7. Encerramento">
        <p>
          Você pode encerrar a conta quando quiser, pelo e-mail de contato. Podemos encerrar o acesso em caso
          de descumprimento destes termos. Encerrada a conta, os dados são apagados conforme a Política de
          Privacidade.
        </p>
      </Section>

      <Section title="8. Mudanças e lei aplicável">
        <p>
          Podemos atualizar estes termos; a data no topo indica a última versão, e mudanças relevantes são
          avisadas no painel. Aplica-se a lei brasileira, no foro do domicílio do usuário.
        </p>
      </Section>
    </LegalLayout>
  );
}
