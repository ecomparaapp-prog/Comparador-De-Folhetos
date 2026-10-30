import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddShoppingListItemBody,
  AnalyzeFlyerBody,
  AnalyzeFlyerResponse,
  GetShoppingListResponse,
  GetSummaryResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  RemoveShoppingListItemParams,
  SaveOffersBody,
  SaveOffersResponse,
  UpdateShoppingListItemBody,
  UpdateShoppingListItemParams,
} from "@workspace/api-zod";
import { db, productOffersTable, shoppingListItemsTable } from "@workspace/db";

const router: IRouter = Router();

type OfferDraft = {
  supermarket: string;
  dataFolheto: string;
  categoria: string;
  produto: string;
  preco: number;
  unidadeMedida: string;
};

function normalizeProductName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asIsoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function parseModelDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  const brDate = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const normalized = brDate
    ? `${brDate[3]}-${brDate[2]}-${brDate[1]}`
    : cleaned.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOfferDraft(value: unknown): OfferDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const supermarket = cleanString(row.supermercado ?? row.supermarket);
  const dataFolheto = parseModelDate(row.data_folheto ?? row.dataFolheto) ?? "";
  const categoria = cleanString(row.categoria ?? row.category);
  const produto = cleanString(row.produto ?? row.product);
  const unidadeMedida = cleanString(row.unidade_medida ?? row.unidadeMedida ?? row.unit);
  const rawPrice = row.preco ?? row.price;
  const preco =
    typeof rawPrice === "number"
      ? rawPrice
      : typeof rawPrice === "string"
        ? Number(rawPrice.replace(",", "."))
        : Number.NaN;

  if (
    !supermarket ||
    !categoria ||
    !produto ||
    !Number.isFinite(preco) ||
    preco < 0 ||
    !unidadeMedida
  ) {
    return null;
  }

  return { supermarket, dataFolheto, categoria, produto, preco, unidadeMedida };
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Resposta da IA não contém JSON válido.");
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

router.post("/flyers/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeFlyerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Envie uma imagem JPEG, PNG ou WebP válida." });
    return;
  }

  const { imageBase64, contentType } = parsed.data;
  if (imageBase64.length > 12_500_000) {
    res.status(413).json({ error: "A imagem excede o limite de tamanho de 9 MB." });
    return;
  }

  const apiKey =
    process.env.OPENAI_COMPATIBLE_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Configure uma chave de API de visão compatível com OpenAI." });
    return;
  }

  const baseUrl =
    process.env.OPENAI_COMPATIBLE_BASE_URL ??
    process.env.OPENROUTER_BASE_URL ??
    "https://openrouter.ai/api/v1";
  const model =
    process.env.OPENAI_COMPATIBLE_MODEL ??
    process.env.OPENROUTER_MODEL ??
    "google/gemma-4-26b-a4b-it:free";
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  try {
    const aiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extraia ofertas de supermercado da imagem. Responda apenas com JSON válido, sem markdown, no formato {\"offers\":[{\"supermercado\":\"...\",\"data_folheto\":\"YYYY-MM-DD\",\"categoria\":\"...\",\"produto\":\"...\",\"preco\":0.00,\"unidade_medida\":\"...\"}]}. Use a data de validade/publicação visível; se não houver uma data legível, use uma string vazia. Não invente preço ou produto; omita campos ilegíveis. Inclua uma oferta por produto e use preço numérico em reais.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Leia o folheto e extraia todos os produtos com preço legível, supermercado e data do folheto.",
              },
              {
                type: "image_url",
                image_url: { url: `data:${contentType};base64,${imageBase64}` },
              },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      req.log.warn(
        { status: aiResponse.status, model },
        "Vision provider rejected flyer analysis",
      );
      res.status(502).json({
        error:
          "Não foi possível analisar o folheto. Verifique o modelo configurado e tente novamente.",
      });
      return;
    }

    const completion = (await aiResponse.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    const content = completion.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => part.text ?? "").join("")
          : "";
    if (!text) throw new Error("A resposta do provedor veio vazia.");

    const raw = parseJsonResponse(text);
    const rawOffers =
      raw && typeof raw === "object" && "offers" in raw
        ? (raw as { offers?: unknown }).offers
        : raw;
    if (!Array.isArray(rawOffers)) throw new Error("A resposta não contém uma lista de ofertas.");

    const offers = rawOffers
      .map(toOfferDraft)
      .filter((offer): offer is OfferDraft => offer !== null);
    if (offers.length === 0) {
      res.status(422).json({
        error: "Nenhum produto completo foi identificado. Envie uma imagem mais nítida.",
      });
      return;
    }

    res.json(AnalyzeFlyerResponse.parse({ offers }));
  } catch (error) {
    req.log.warn({ err: error, model }, "Flyer analysis could not be parsed");
    res.status(502).json({
      error: "A leitura do folheto falhou. Tente uma imagem mais nítida ou revise o modelo.",
    });
  }
});

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Busca inválida." });
    return;
  }

  const allOffers = await db
    .select()
    .from(productOffersTable)
    .orderBy(asc(productOffersTable.productName), asc(productOffersTable.supermarket));
  const search = query.data.search ? normalizeProductName(query.data.search) : "";
  const filtered = allOffers.filter(
    (offer) => !search || offer.normalizedName === search,
  );
  const grouped = new Map<string, typeof filtered>();
  for (const offer of filtered) {
    const existing = grouped.get(offer.normalizedName) ?? [];
    existing.push(offer);
    grouped.set(offer.normalizedName, existing);
  }

  const comparisons = Array.from(grouped.values()).map((offers) => {
    const lowestPrice = Math.min(...offers.map((offer) => Number(offer.price)));
    const highestPrice = Math.max(...offers.map((offer) => Number(offer.price)));
    return {
      productName: offers[0]!.productName,
      category: offers[0]!.category,
      unit: offers[0]!.unit,
      lowestPrice,
      highestPrice,
      offers: offers.map((offer) => {
        const price = Number(offer.price);
        const difference = roundMoney(price - lowestPrice);
        return {
          supermarket: offer.supermarket,
          dataFolheto: offer.flyerDate,
          categoria: offer.category,
          produto: offer.productName,
          preco: price,
          unidadeMedida: offer.unit,
          id: offer.id,
          economiaReais: difference,
          economiaPercentual: price > 0 ? roundMoney((difference / price) * 100) : 0,
        };
      }),
    };
  });

  res.json(ListProductsResponse.parse(comparisons));
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = SaveOffersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revise os campos das ofertas antes de salvar." });
    return;
  }

  let created = 0;
  let updated = 0;
  let ignored = 0;

  await db.transaction(async (tx) => {
    for (const offer of parsed.data.offers) {
      const normalizedName = normalizeProductName(offer.produto);
      const flyerDate = asIsoDate(offer.dataFolheto);
      const [existing] = await tx
        .select()
        .from(productOffersTable)
        .where(
          and(
            eq(productOffersTable.supermarket, offer.supermarket.trim()),
            eq(productOffersTable.normalizedName, normalizedName),
          ),
        )
        .limit(1);

      if (existing && existing.flyerDate > flyerDate) {
        ignored += 1;
        continue;
      }

      if (existing) {
        await tx
          .update(productOffersTable)
          .set({
            flyerDate,
            category: offer.categoria.trim(),
            productName: offer.produto.trim(),
            normalizedName,
            price: offer.preco.toFixed(2),
            unit: offer.unidadeMedida.trim(),
          })
          .where(eq(productOffersTable.id, existing.id));
        updated += 1;
        continue;
      }

      const [inserted] = await tx
        .insert(productOffersTable)
        .values({
          supermarket: offer.supermarket.trim(),
          flyerDate,
          category: offer.categoria.trim(),
          productName: offer.produto.trim(),
          normalizedName,
          price: offer.preco.toFixed(2),
          unit: offer.unidadeMedida.trim(),
        })
        .onConflictDoNothing()
        .returning({ id: productOffersTable.id });

      if (inserted) {
        created += 1;
      } else {
        const [racedOffer] = await tx
          .select()
          .from(productOffersTable)
          .where(
            and(
              eq(productOffersTable.supermarket, offer.supermarket.trim()),
              eq(productOffersTable.normalizedName, normalizedName),
            ),
          )
          .limit(1);

        if (!racedOffer || racedOffer.flyerDate > flyerDate) {
          ignored += 1;
        } else {
          await tx
            .update(productOffersTable)
            .set({
              flyerDate,
              category: offer.categoria.trim(),
              productName: offer.produto.trim(),
              price: offer.preco.toFixed(2),
              unit: offer.unidadeMedida.trim(),
            })
            .where(eq(productOffersTable.id, racedOffer.id));
          updated += 1;
        }
      }
    }
  });

  res.json(SaveOffersResponse.parse({ created, updated, ignored }));
});

router.get("/summary", async (_req, res): Promise<void> => {
  const offers = await db.select().from(productOffersTable);
  const latestFlyerDate = offers.reduce<string | null>(
    (latest, offer) => (!latest || offer.flyerDate > latest ? offer.flyerDate : latest),
    null,
  );
  const summary = {
    productCount: new Set(offers.map((offer) => offer.normalizedName)).size,
    storeCount: new Set(offers.map((offer) => offer.supermarket)).size,
    offerCount: offers.length,
    latestFlyerDate,
  };
  res.json(GetSummaryResponse.parse(summary));
});

async function buildShoppingListResponse() {
  const items = await db
    .select({
      id: shoppingListItemsTable.id,
      productName: shoppingListItemsTable.productName,
      normalizedName: shoppingListItemsTable.normalizedName,
      quantity: shoppingListItemsTable.quantity,
    })
    .from(shoppingListItemsTable)
    .orderBy(asc(shoppingListItemsTable.productName));
  const offers = await db.select().from(productOffersTable);
  const stores = Array.from(new Set(offers.map((offer) => offer.supermarket)));
  const storeTotals = stores.map((supermarket) => {
    let total = 0;
    let coveredItems = 0;
    for (const item of items) {
      const available = offers
        .filter(
          (offer) =>
            offer.supermarket === supermarket &&
            offer.normalizedName === item.normalizedName,
        )
        .sort((a, b) => Number(a.price) - Number(b.price))[0];
      if (available) {
        total += Number(available.price) * item.quantity;
        coveredItems += 1;
      }
    }
    return {
      supermarket,
      total: roundMoney(total),
      coveredItems,
      missingItems: items.length - coveredItems,
    };
  });
  const completeStores =
    items.length > 0
      ? storeTotals.filter((store) => store.missingItems === 0)
      : [];
  completeStores.sort((a, b) => a.total - b.total);
  const cheapestStore = completeStores[0]?.supermarket ?? null;
  const totalSavings =
    completeStores.length > 1
      ? roundMoney(completeStores[completeStores.length - 1]!.total - completeStores[0]!.total)
      : 0;

  return GetShoppingListResponse.parse({
    items: items.map(({ id, productName, quantity }) => ({
      id,
      productName,
      quantity,
    })),
    storeTotals,
    cheapestStore,
    totalSavings,
  });
}

router.get("/shopping-list", async (_req, res): Promise<void> => {
  res.json(await buildShoppingListResponse());
});

router.post("/shopping-list", async (req, res): Promise<void> => {
  const parsed = AddShoppingListItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Informe o produto e uma quantidade válida." });
    return;
  }

  const normalizedName = normalizeProductName(parsed.data.productName);
  const [offer] = await db
    .select({ productName: productOffersTable.productName })
    .from(productOffersTable)
    .where(eq(productOffersTable.normalizedName, normalizedName))
    .limit(1);
  if (!offer) {
    res.status(404).json({ error: "Produto não encontrado no catálogo de ofertas." });
    return;
  }

  const [existing] = await db
    .select()
    .from(shoppingListItemsTable)
    .where(eq(shoppingListItemsTable.normalizedName, normalizedName))
    .limit(1);
  if (existing) {
    await db
      .update(shoppingListItemsTable)
      .set({ quantity: existing.quantity + parsed.data.quantity, productName: offer.productName })
      .where(eq(shoppingListItemsTable.id, existing.id));
  } else {
    await db.insert(shoppingListItemsTable).values({
      productName: offer.productName,
      normalizedName,
      quantity: parsed.data.quantity,
    });
  }

  res.status(201).json(await buildShoppingListResponse());
});

router.patch("/shopping-list/:id", async (req, res): Promise<void> => {
  const params = UpdateShoppingListItemParams.safeParse(req.params);
  const body = UpdateShoppingListItemBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Quantidade inválida." });
    return;
  }

  const [updated] = await db
    .update(shoppingListItemsTable)
    .set({ quantity: body.data.quantity })
    .where(eq(shoppingListItemsTable.id, params.data.id))
    .returning({ id: shoppingListItemsTable.id });
  if (!updated) {
    res.status(404).json({ error: "Produto não encontrado na lista." });
    return;
  }
  res.json(await buildShoppingListResponse());
});

router.delete("/shopping-list/:id", async (req, res): Promise<void> => {
  const params = RemoveShoppingListItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Identificador inválido." });
    return;
  }

  const [removed] = await db
    .delete(shoppingListItemsTable)
    .where(eq(shoppingListItemsTable.id, params.data.id))
    .returning({ id: shoppingListItemsTable.id });
  if (!removed) {
    res.status(404).json({ error: "Produto não encontrado na lista." });
    return;
  }
  res.json(await buildShoppingListResponse());
});

export default router;
