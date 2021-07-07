const express = require("express");
const cors = require("cors");
const knex = require("knex");
const app = express();
const { default: axios } = require("axios");
const CodigoEstabelecimento = "96702534PC23";
const port = 3040;
const chaveIntegracao = 9191;
require("dotenv").config();
const trigger = `
TRIGGER  MudarCodCliente
   ON  [Cartoes Gerados]
   AFTER INSERT
AS 
  BEGIN
    SET NOCOUNT ON;
    DECLARE @id INT=(SELECT top 1 [Código Cliente] FROM [Cartoes Gerados] ORDER BY [Data/Hora] desc)
    UPDATE Clientes 
    SET [Código Externo]=(select top 1 Cartão from [Cartoes Gerados] where [Código Cliente]=@id ORDER BY [Data/Hora] desc)
    WHERE [Código Cliente]=@id
  END
`;

const server = () => {
  const ms = 99999999;
  const database = knex({
    client: "mssql",
    connection: {
      server: "localhost",
      user: "sa",
      password: process.env.password,
      database: "MISTERCHEFNET",
      connectTimeout: ms,
      requestTimeout: ms,
    },
    pool: {
      min: 0,
      max: 500,
      idleTimeoutMillis: ms,
    },
  });

  database
    .raw(
      `
    IF OBJECT_ID ('MudarCodCliente', 'TR') IS NULL
      EXEC ('CREATE ${trigger}')
    ELSE 
      EXEC ('ALTER ${trigger}')
  `
    )
    .then((e) => console.log("Criou a Trigger"))
    .catch((e) => console.log("Falhou"));
  app.use(cors());
  app.use(express.json());

  const getEmUso = (rfid) =>
    database
      .select("Mesa")
      .from("StatusMesa")
      .where({ Mesa: rfid })
      .then((e) => ({ emUso: e.length > 0 }));

  const getSaldo = (rfid) =>
    new Promise((resolve, reject) => {
      Promise.all([
        database
          .raw(
            `
            SELECT ISNULL(SUM(CCA.Entrada-CCA.Saida),0) as saldo
            FROM Clientes C
            LEFT JOIN [Cartoes Gerados] CG ON CG.[Código Cliente]=C.[Código Cliente]
            LEFT JOIN [Conta Corrente Assinada] CCA ON CCA.[Código Cliente]=c.[Código Cliente]
            WHERE C.[Código Externo]=${rfid}
            GROUP BY C.[Código Cliente],CCA.[Código Cliente],C.[Código Externo]
          `
          )
          .then((e) => e?.[0]?.saldo ?? 0),
        axios
          .post(
            "http://localhost/IntegracaoPedidosOnlineIntranet/CartaoService.svc/ConsultarMovimentacaoCartao",
            {
              parametros: {
                CodigoEstabelecimento,
                CodigoIntegracao: 99,
                NumeroCartao: rfid,
                RequestID: null,
                TipoServico: null,
              },
            }
          )
          .then(
            (e) =>
              e.data?.ConsultarMovimentacaoCartaoResult?.Totais?.TotalConta ?? 0
          ),
      ])
        .then(([credito, mov]) => resolve({ saldo: credito - mov }))
        .catch((e) => reject(e));
    });

  app.post("/credito/salvar-consumo", (req, res) => {
    const {
      rfid,
      idProdutoIntegracao,
      idConsumo,
      precoPorlitro,
      valorTransacao,
      quantidadeExtraidaMl,
    } = req.body;
    const json = {
      parametros: {
        Pedido: {
          NumeroCartao: rfid,
          NumeroMesaEntrega: 9999,
          CodigoGarcom: 0,
          Itens: [
            {
              CodigoExterno: idConsumo,
              TipoItem: 0,
              Produto: {
                Codigo: idProdutoIntegracao,
                Descricao: "BeerPass",
                PrecoVenda: precoPorlitro,
                PrecoOriginal: 0,
                PrecoPromocional: 0,
                Pesavel: true,
                Processado: false,
                ProdutoComposto: false,
                BaixarEstoqueOnline: false,
                QuantidadeEstoque: 0,
                Composicoes: null,
              },
              Quantidade: quantidadeExtraidaMl / 1000,
              Acrescimo: 0,
              Desconto: 0,
              MotivoAcrescimoDesconto: null,
              AcrescimoDiferencaFracionada: 0,
              Observacao: "",
              ItensFracao: null,
              ItensAdicionais: [],
              ValorTotal: valorTransacao,
              ValorDescontoItem: 0,
              ValorServicoItem: 0,
              ValorDescontoComboItem: 0,
              ValorAcrescimoItem: 0,
              TipoOperacao: 0,
            },
          ],
        },
        CodigoEstabelecimento,
        CodigoIntegracao: 99,
        RequestID: null,
        TipoServico: null,
      },
    };
    axios
      .post(
        "http://localhost/IntegracaoPedidosOnlineIntranet/CartaoService.svc/EnviarPedido",
        json
      )
      .then(async (e) => {
        console.log(e.data);

        const json = Object.assign(
          ...(await Promise.all([getEmUso(rfid), getSaldo(rfid)]))
        );
        return res.status(200).json(json);
      })
      .catch((e) => {
        console.log(e);
        return res.status(500).end();
      });
  });

  app.post("/credito/bloquear", async (req, res) => {
    const { rfid } = req.body;
    try {
      if (req.headers?.["chave-integracao"] == chaveIntegracao && rfid) {
        if (
          (
            await database
              .select("Mesa")
              .from("StatusMesa")
              .where({ Mesa: rfid })
          )?.length === 0
        ) {
          await database("StatusMesa").insert({
            Mesa: rfid,
            Terminal: 1,
            Caixa: 1000,
          });
          return res.status(200).json({ emUso: true });
        } else return res.status(200).json({ emUso: true });
      } else throw { status: 401 };
    } catch (error) {
      return res.status(error?.status ?? 500).end();
    }
  });

  app.post("/credito/desbloquear", async (req, res) => {
    const { rfid } = req.body;
    try {
      if (req.headers?.["chave-integracao"] == chaveIntegracao && rfid) {
        await database("StatusMesa")
          .where({ Mesa: rfid, Terminal: 1, Caixa: 1000 })
          .del();
        return res.status(200).json({ emUso: false });
      } else throw { status: 401 };
    } catch (error) {
      return res.status(error?.status ?? 500).end();
    }
  });

  app.get("/credito/obter-rfid", async (req, res) => {
    try {
      const { rfid } = req.query;
      if (req.headers?.["chave-integracao"] == chaveIntegracao && rfid) {
        const emUso = getEmUso(rfid);

        const nomeECPF = database
          .select({
            nome: "Nome Cliente",
            cpf: "cpf",
          })
          .from("Clientes")
          .where({ "Código Externo": rfid })
          .then((e) => ({
            nome: e?.[0]?.nome ?? "",
            cpf: String(e?.[0]?.cpf).replace(/\D/g, ""),
          }));
        const saldo = getSaldo(rfid);
        const json = Object.assign(
          ...(await Promise.all([emUso, nomeECPF, saldo])),
          { rfid }
        );

        return res.status(200).json(json);
      } else throw { status: 401 };
    } catch (error) {
      return res.status(error?.status ?? 500).end();
    }
  });

  app.listen(port, () => {
    console.log("Servidor está aberto");
  });
};

module.exports = server;