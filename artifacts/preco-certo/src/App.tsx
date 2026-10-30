import { type ReactNode, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  useAddShoppingListItem,
  useAnalyzeFlyer,
  useGetShoppingList,
  useGetSummary,
  useListProducts,
  useRemoveShoppingListItem,
  useSaveOffers,
  useUpdateShoppingListItem,
  getGetShoppingListQueryKey,
  getGetSummaryQueryKey,
  getListProductsQueryKey,
} from '@workspace/api-client-react';
import type { OfferDraft, ProductComparison } from '@workspace/api-client-react';
import {
  ArrowDownRight, ArrowRight, Check, CirclePlus, ClipboardList, FileImage, ImagePlus,
  LoaderCircle, Minus, PackageSearch, Plus, ReceiptText, RotateCcw, RotateCw, Search,
  ShoppingBasket, Sparkles, Trash2, TrendingDown, UploadCloud, X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const currency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const datePt = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : 'Ainda sem leitura';
const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
type FlyerContentType = 'image/jpeg' | 'image/png' | 'image/webp';

function rotateImageDataUrl(dataUrl: string, degrees: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const angle = ((degrees % 360) + 360) % 360;
      const swapsDimensions = angle === 90 || angle === 270;
      const canvas = document.createElement('canvas');
      canvas.width = swapsDimensions ? image.naturalHeight : image.naturalWidth;
      canvas.height = swapsDimensions ? image.naturalWidth : image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Não foi possível preparar a imagem.'));
        return;
      }
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((angle * Math.PI) / 180);
      context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.94));
    };
    image.onerror = () => reject(new Error('Não foi possível abrir a imagem para girar.'));
    image.src = dataUrl;
  });
}

function getApiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('data' in error)) return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !('error' in data)) return null;
  const message = (data as { error?: unknown }).error;
  return typeof message === 'string' ? message : null;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const nav = [{ href: '/', label: 'Comparar', icon: Search }, { href: '/encartes', label: 'Enviar', icon: ReceiptText }, { href: '/lista', label: 'Minha lista', icon: ClipboardList }];
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark"><TrendingDown size={20} /></span><span>preço certo</span></Link>
      <nav className="nav-links" aria-label="Navegação principal">{nav.map(item => <Link key={item.href} href={item.href} className={`nav-link ${location === item.href ? 'active' : ''}`} data-testid={`link-nav-${item.label.toLowerCase().replace(' ', '-')}`}><item.icon size={16} />{item.label}</Link>)}</nav>
      <Link href="/lista" className="nav-cta" data-testid="link-open-list"><ShoppingBasket size={16} /> Ver minha lista <ArrowRight size={14} /></Link>
    </header>
    <main>{children}</main>
    <nav className="mobile-bottom" aria-label="Navegação móvel">{nav.map(item => <Link key={item.href} href={item.href} className={location === item.href ? 'active' : ''} data-testid={`mobile-nav-${item.label.toLowerCase().replace(' ', '-')}`}><item.icon size={18} />{item.label}</Link>)}</nav>
  </div>;
}

function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div>;
}

function StateError({ retry, message = 'Não foi possível carregar agora.' }: { retry: () => void; message?: string }) {
  return <div className="error-state" role="alert"><div className="empty-icon"><X size={20} /></div><div className="empty-title">Ops, algo não saiu como esperado</div><p className="empty-copy">{message} Tente novamente em instantes.</p><button className="button secondary" onClick={retry} data-testid="button-retry">Tentar de novo</button></div>;
}

function EmptyState({ title, copy, icon = PackageSearch }: { title: string; copy: string; icon?: typeof PackageSearch }) {
  const Icon = icon;
  return <div className="empty-state"><div className="empty-icon"><Icon size={20} /></div><div className="empty-title">{title}</div><p className="empty-copy">{copy}</p></div>;
}

function CatalogPage() {
  const summary = useGetSummary();
  const [searchText, setSearchText] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState<string | undefined>(undefined);
  const products = useListProducts(submittedSearch ? { search: submittedSearch } : undefined);
  const queryClient = useQueryClient();
  const addItem = useAddShoppingListItem({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetShoppingListQueryKey() }) } });
  const [addedProduct, setAddedProduct] = useState('');
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedSearch(searchText.trim() ? normalizeName(searchText) : undefined);
  };
  const addProduct = (name: string) => addItem.mutate({ data: { productName: name, quantity: 1 } }, { onSuccess: () => { setAddedProduct(name); window.setTimeout(() => setAddedProduct(''), 2600); } });
  const rows = products.data ?? [];
  return <div className="page-wrap">
    <section className="home-hero">
      <div className="hero-copy">
        <span className="eyebrow">Compra boa começa antes do mercado</span>
        <h1 className="hero-title">O preço certo.<br /><em>Sem adivinhação.</em></h1>
        <p className="page-subtitle">Compare preços de folhetos e notas fiscais e descubra onde cada compra pesa menos no bolso.</p>
        <div style={{ marginTop: 23 }}><a className="button" href="#comparador" data-testid="link-start-comparing">Comparar preços <ArrowRight size={16} /></a></div>
      </div>
      <div className="hero-visual" aria-label="Ilustração de uma etiqueta de preço comparada">
        <div className="receipt"><div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Oferta da semana</div><div className="receipt-line" /><div style={{ fontSize: 11 }}>Arroz tipo 1 · 5 kg</div><div className="receipt-line" /><div style={{ fontSize: 10, color: '#7a887e' }}>menor preço</div><div className="receipt-price">R$ 24,90</div></div>
        <div className="visual-caption">Menos procura. Mais economia.</div>
      </div>
    </section>
    <section className="summary-strip" aria-label="Resumo do catálogo">
      {summary.isLoading ? [0, 1, 2, 3].map(i => <div className="summary-cell" key={i}><div className="skeleton" style={{ height: 42, opacity: .3 }} /></div>) :
        summary.isError ? <div className="summary-cell" style={{ gridColumn: '1/-1' }}><span>Resumo indisponível no momento.</span> <button className="button secondary" onClick={() => summary.refetch()}>Recarregar</button></div> :
          <>
            <div className="summary-cell"><div className="summary-num" data-testid="summary-product-count">{summary.data?.productCount ?? 0}</div><div className="summary-label">produtos comparados</div></div>
            <div className="summary-cell"><div className="summary-num" data-testid="summary-store-count">{summary.data?.storeCount ?? 0}</div><div className="summary-label">supermercados</div></div>
            <div className="summary-cell"><div className="summary-num" data-testid="summary-offer-count">{summary.data?.offerCount ?? 0}</div><div className="summary-label">ofertas registradas</div></div>
            <div className="summary-cell"><div className="summary-num" style={{ fontSize: 17 }} data-testid="summary-latest-date">{datePt(summary.data?.latestFlyerDate)}</div><div className="summary-label">data mais recente</div></div>
          </>}
    </section>
    <section id="comparador">
      <div className="section-head"><div><div className="eyebrow">Comparação direta</div><h2 className="section-title" style={{ marginTop: 6 }}>Quanto custa por aí?</h2></div><Link href="/encartes" className="inline-link" data-testid="link-upload-flyer">Enviar folheto ou nota <ArrowRight size={13} style={{ verticalAlign: 'middle' }} /></Link></div>
      <form className="search-panel" onSubmit={submitSearch}>
        <Search size={18} color="#829087" /><input aria-label="Nome exato do produto" data-testid="input-product-search" placeholder="Digite o nome do produto, por exemplo: arroz tipo 1" value={searchText} onChange={event => setSearchText(event.target.value)} />
        {searchText && <button type="button" className="button ghost" aria-label="Limpar busca" onClick={() => { setSearchText(''); setSubmittedSearch(undefined); }} data-testid="button-clear-search"><X size={16} /></button>}
        <button className="button" type="submit" disabled={products.isFetching} data-testid="button-search"><Search size={15} /> Buscar</button>
      </form>
      {addedProduct && <div className="status-message status-success" role="status" data-testid="status-added-product"><Check size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />{addedProduct} entrou na sua lista.</div>}
      {products.isLoading ? <div className="offers-list"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> :
        products.isError ? <StateError retry={() => products.refetch()} /> :
          rows.length === 0 ? <EmptyState title={submittedSearch ? 'Nenhum produto com esse nome' : 'Seu comparador está começando'} copy={submittedSearch ? 'A busca compara o nome exato do produto. Confira a grafia ou tente um nome completo diferente.' : 'Quando enviar folhetos ou notas fiscais, os preços aparecem aqui. Você também pode enviar um documento agora.'} icon={submittedSearch ? Search : ShoppingBasket} /> :
            <div className="offers-list">{rows.map((product, index) => <ProductCard key={`${product.productName}-${index}`} product={product} onAdd={() => addProduct(product.productName)} pending={addItem.isPending} />)}</div>}
    </section>
    <section style={{ marginTop: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: '22px 24px', background: '#eeeade', borderRadius: 18 }}>
      <div><div className="eyebrow">Sua próxima compra</div><h2 className="section-title" style={{ marginTop: 5 }}>Monte a lista antes de sair.</h2><p style={{ fontSize: 13, color: '#737e74', marginBottom: 0 }}>Veja o total previsto em cada supermercado.</p></div>
      <Link href="/lista" className="button" data-testid="link-build-list">Abrir lista <ArrowRight size={15} /></Link>
    </section>
  </div>;
}

function ProductCard({ product, onAdd, pending }: { product: ProductComparison; onAdd: () => void; pending: boolean }) {
  const best = product.offers.reduce((current, offer) => offer.preco < current.preco ? offer : current, product.offers[0]);
  return <article className="product-card surface" data-testid={`card-product-${normalizeName(product.productName).replace(/\s/g, '-')}`}>
    <div><div className="product-name">{product.productName}</div><div className="product-meta">{product.category} · {product.unit}</div><div className="price-range">{product.offers.length} {product.offers.length === 1 ? 'oferta' : 'ofertas'} · de {currency(product.lowestPrice)} a {currency(product.highestPrice)}</div></div>
    <div className="offer-best"><div className="best-label">Menor preço</div><div className="price">{currency(best.preco)}</div></div>
    <div className="store-pill">{best.supermarket}</div>
    <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 9, borderTop: '1px solid #eeece3', paddingTop: 12 }} aria-label={`Preços em ${product.productName}`}>
      {product.offers.slice().sort((a, b) => a.preco - b.preco).map(offer => {
        const isBest = offer.preco === product.lowestPrice;
        return <div key={offer.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }} data-testid={`offer-price-${offer.id}`}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 650, color: '#39463d' }}>{offer.supermarket}{isBest && <span style={{ marginLeft: 8, color: '#5b8660', fontSize: 9, letterSpacing: '.7px', textTransform: 'uppercase' }}>mais barato</span>}</div>
            {!isBest && <div style={{ fontSize: 11, color: '#758178', marginTop: 3 }}>Economia de {currency(offer.economiaReais)} ({offer.economiaPercentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%) comprando no {best.supermarket}</div>}
          </div>
          <strong style={{ fontSize: 15, color: isBest ? '#33754d' : '#424e45', whiteSpace: 'nowrap' }}>{currency(offer.preco)}</strong>
        </div>;
      })}
    </div>
    <button className="button secondary" style={{ gridColumn: '1 / -1', justifySelf: 'start' }} onClick={onAdd} disabled={pending} data-testid={`button-add-${normalizeName(product.productName).replace(/\s/g, '-')}`}><CirclePlus size={15} /> Adicionar à lista</button>
  </article>;
}

function FlyersPage() {
  const analyze = useAnalyzeFlyer();
  const save = useSaveOffers();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<OfferDraft[]>([]);
  const [preview, setPreview] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ imageBase64: string; contentType: FlyerContentType } | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const [fileName, setFileName] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!(['image/jpeg', 'image/png', 'image/webp'] as string[]).includes(file.type)) {
      setMessage({ kind: 'error', text: 'Escolha uma imagem JPG, PNG ou WebP.' });
      event.target.value = '';
      return;
    }
    if (file.size > 9 * 1024 * 1024) {
      setMessage({ kind: 'error', text: 'A imagem deve ter até 9 MB. Comprima ou recorte a foto e tente novamente.' });
      event.target.value = '';
      return;
    }
    setFileName(file.name);
    setDrafts([]);
    setMessage(null);
    event.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setPreview(dataUrl);
      setSelectedImage({
        imageBase64: dataUrl.split(',')[1],
        contentType: file.type as FlyerContentType,
      });
      setMessage({ kind: 'info', text: 'Imagem pronta. Gire-a se necessário e toque em “Ler documento”.' });
    };
    reader.onerror = () => setMessage({ kind: 'error', text: 'Não foi possível abrir o arquivo selecionado.' });
    reader.readAsDataURL(file);
  };

  const rotateSelectedImage = async (degrees: number) => {
    if (!preview || isRotating) return;
    setIsRotating(true);
    try {
      const rotated = await rotateImageDataUrl(preview, degrees);
      setPreview(rotated);
      setSelectedImage({ imageBase64: rotated.split(',')[1], contentType: 'image/jpeg' });
      setMessage({ kind: 'info', text: 'Imagem girada. Toque em “Ler documento” para extrair os produtos.' });
    } catch {
      setMessage({ kind: 'error', text: 'Não foi possível girar a imagem. Tente salvá-la novamente como JPG ou PNG.' });
    } finally {
      setIsRotating(false);
    }
  };

  const analyzeSelectedImage = () => {
    if (!selectedImage || analyze.isPending) return;
    setMessage(null);
    analyze.mutate({ data: selectedImage }, {
      onSuccess: result => {
        setDrafts(result.offers);
        setMessage(result.offers.length ? { kind: 'success', text: `${result.offers.length} ${result.offers.length === 1 ? 'produto identificado' : 'produtos identificados'}. Confira os dados antes de salvar.` } : { kind: 'info', text: 'Não encontramos produtos com preço legível. Tente girar a imagem ou enviar uma foto mais nítida.' });
      },
      onError: error => setMessage({ kind: 'error', text: getApiErrorMessage(error) ?? 'Não foi possível conectar ao serviço de leitura. Tente novamente em instantes.' }),
    });
  };
  const updateDraft = (index: number, key: keyof OfferDraft, value: string) => setDrafts(current => current.map((draft, i) => i !== index ? draft : { ...draft, [key]: key === 'preco' ? Number(value) : value }));
  const removeDraft = (index: number) => setDrafts(current => current.filter((_, i) => i !== index));
  const saveDrafts = () => {
    if (!drafts.length) return;
    save.mutate({ data: { offers: drafts.map(({ supermarket, dataFolheto, categoria, produto, preco, unidadeMedida }) => ({ supermarket, dataFolheto, categoria, produto, preco, unidadeMedida })) } }, {
      onSuccess: result => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
        setMessage({ kind: 'success', text: `Pronto: ${result.created} novas ofertas salvas, ${result.updated} atualizadas${result.ignored ? ` e ${result.ignored} ignoradas` : ''}.` });
        setDrafts([]);
        setPreview('');
        setSelectedImage(null);
        setFileName('');
        if (inputRef.current) inputRef.current.value = '';
      },
      onError: () => setMessage({ kind: 'error', text: 'As ofertas não foram salvas. Revise os campos e tente novamente.' }),
    });
  };

  return <div className="page-wrap">
    <PageHeading eyebrow="Folhetos e notas fiscais" title="Do papel para a sua lista." subtitle="Envie uma foto do folheto ou da nota fiscal. Revise produtos, preços e unidades antes de comparar." />
    <div className="flyer-layout">
      <section className="surface panel">
        <h2 className="panel-heading">1. Envie o documento</h2><p className="panel-desc">Use uma imagem nítida do folheto, nota fiscal ou cupom, com os itens e valores visíveis.</p>
        <div className="upload-box">
          <div className="upload-icon"><ImagePlus size={23} /></div>
          <h3 className="upload-title">{fileName || 'Escolha um folheto ou nota fiscal'}</h3>
          <p className="upload-text">JPG, PNG ou WebP. A leitura identifica produtos, preços e unidades como kg e L.</p>
          <input className="file-input" ref={inputRef} id="flyer-upload" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleFile} data-testid="input-flyer-image" />
          <label htmlFor="flyer-upload" className="button" style={{ cursor: 'pointer' }} data-testid="button-choose-flyer"><UploadCloud size={16} /> Escolher imagem</label>
          {preview && <img className="flyer-preview" src={preview} alt="Prévia do folheto ou nota fiscal selecionada" data-testid="img-flyer-preview" />}
          {selectedImage && <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <button type="button" className="button secondary" onClick={() => void rotateSelectedImage(-90)} disabled={isRotating || analyze.isPending} aria-label="Girar imagem 90 graus para a esquerda" data-testid="button-rotate-left"><RotateCcw size={15} /> −90°</button>
            <button type="button" className="button secondary" onClick={() => void rotateSelectedImage(90)} disabled={isRotating || analyze.isPending} aria-label="Girar imagem 90 graus para a direita" data-testid="button-rotate-right"><RotateCw size={15} /> +90°</button>
            <button type="button" className="button" onClick={analyzeSelectedImage} disabled={isRotating || analyze.isPending} data-testid="button-analyze-document">{analyze.isPending ? <><LoaderCircle size={15} className="animate-spin" /> Lendo…</> : <><Sparkles size={15} /> Ler documento</>}</button>
          </div>}
          {analyze.isPending && <div className="status-message status-info" role="status"><LoaderCircle size={14} className="animate-spin" style={{ verticalAlign: 'middle', marginRight: 7 }} />Lendo produtos e preços…</div>}
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 11, alignItems: 'flex-start', color: '#77847b', fontSize: 11, lineHeight: 1.55 }}><FileImage size={17} /><span>Confira sempre o produto, a unidade e o preço extraídos. A leitura automática pode precisar de ajustes.</span></div>
      </section>
      <section className="surface panel">
        <h2 className="panel-heading">2. Revise as ofertas</h2><p className="panel-desc">Corrija qualquer informação antes de salvar no comparador.</p>
        {message && <div className={`status-message status-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'} data-testid={`status-flyer-${message.kind}`}>{message.text}</div>}
        {!drafts.length && !analyze.isPending ? <EmptyState title="Os produtos aparecem aqui" copy="Depois de enviar um folheto ou nota fiscal, revise produto, preço, unidade e supermercado." icon={ReceiptText} /> :
          <>
            <div className="draft-row draft-header"><span>Produto · categoria</span><span>Supermercado</span><span>Data folheto / compra</span><span>Preço · unidade</span><span /></div>
            {drafts.map((draft, index) => <div className="draft-row" key={`${draft.produto}-${index}`} data-testid={`row-draft-offer-${index}`}>
              <div style={{ display: 'grid', gap: 6 }}><input className="field" aria-label={`Produto ${index + 1}`} value={draft.produto} onChange={e => updateDraft(index, 'produto', e.target.value)} data-testid={`input-draft-product-${index}`} /><input className="field" aria-label={`Categoria ${index + 1}`} value={draft.categoria} onChange={e => updateDraft(index, 'categoria', e.target.value)} data-testid={`input-draft-category-${index}`} /></div>
              <input className="field" aria-label={`Supermercado ${index + 1}`} value={draft.supermarket} onChange={e => updateDraft(index, 'supermarket', e.target.value)} data-testid={`input-draft-store-${index}`} />
              <input className="field" type="date" aria-label={`Data do folheto ou compra ${index + 1}`} value={draft.dataFolheto.slice(0, 10)} onChange={e => updateDraft(index, 'dataFolheto', e.target.value)} data-testid={`input-draft-date-${index}`} />
              <div style={{ display: 'flex', gap: 5 }}><input className="field" aria-label={`Preço ${index + 1}`} type="number" min="0" step="0.01" value={draft.preco} onChange={e => updateDraft(index, 'preco', e.target.value)} data-testid={`input-draft-price-${index}`} /><input className="field" aria-label={`Unidade ${index + 1}`} value={draft.unidadeMedida} onChange={e => updateDraft(index, 'unidadeMedida', e.target.value)} data-testid={`input-draft-unit-${index}`} /></div>
              <button className="button ghost danger" onClick={() => removeDraft(index)} aria-label={`Remover oferta ${draft.produto}`} data-testid={`button-remove-draft-${index}`}><Trash2 size={16} /></button>
            </div>)}
            <button className="button" style={{ width: '100%', marginTop: 17 }} disabled={!drafts.length || save.isPending || drafts.some(d => !d.produto.trim() || !d.supermarket.trim() || d.supermarket === 'Supermercado não identificado' || !d.dataFolheto || !d.categoria.trim() || !d.unidadeMedida.trim() || !Number.isFinite(d.preco) || d.preco < 0)} onClick={saveDrafts} data-testid="button-save-offers">{save.isPending ? <><LoaderCircle size={16} className="animate-spin" /> Salvando…</> : <><Check size={16} /> Salvar {drafts.length} {drafts.length === 1 ? 'oferta' : 'ofertas'}</>}</button>
          </>}
      </section>
    </div>
    <div className="status-message status-info" style={{ marginTop: 24 }}><Sparkles size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />As ofertas salvas entram na comparação e ajudam a calcular sua lista por supermercado.</div>
  </div>;
}

function ShoppingListPage() {
  const list = useGetShoppingList();
  const queryClient = useQueryClient();
  const add = useAddShoppingListItem({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetShoppingListQueryKey() }) } });
  const update = useUpdateShoppingListItem({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetShoppingListQueryKey() }) } });
  const remove = useRemoveShoppingListItem({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetShoppingListQueryKey() }) } });
  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [formError, setFormError] = useState('');
  const data = list.data;
  const storeTotals = useMemo(() => data?.storeTotals ?? [], [data?.storeTotals]);
  const complete = storeTotals.filter(store => store.missingItems === 0).sort((a, b) => a.total - b.total);
  const bestStore = complete[0] ?? storeTotals.slice().sort((a, b) => a.total - b.total)[0];
  const submitAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!product.trim()) { setFormError('Digite o nome do produto para adicionar.'); return; }
    setFormError('');
    add.mutate({ data: { productName: product.trim(), quantity } }, { onSuccess: () => { setProduct(''); setQuantity(1); } });
  };
  const changeQuantity = (id: number, current: number, amount: number) => {
    const next = current + amount;
    if (next >= 1) update.mutate({ id, data: { quantity: next } });
  };
  return <div className="page-wrap">
    <PageHeading eyebrow="Planeje antes de sair" title="Sua lista, sem surpresa no caixa." subtitle="Ajuste quantidades e compare o total com as ofertas cadastradas. Você vê o que já tem preço e o que ainda falta." />
    {data && data.items.length > 0 && <div className="saving-note" data-testid="text-list-savings"><ArrowDownRight size={20} />{data.totalSavings > 0 ? <>Com a melhor opção coberta, você pode economizar <strong>{currency(data.totalSavings)}</strong>.</> : 'Sua comparação está atualizada com as ofertas disponíveis.'}</div>}
    <div className="list-layout">
      <section className="surface panel">
        <h2 className="panel-heading">O que vai na sacola?</h2><p className="panel-desc">Inclua produtos e ajuste a quantidade que precisa.</p>
        <form onSubmit={submitAdd} className="add-row">
          <input className="field" value={product} onChange={e => setProduct(e.target.value)} placeholder="Nome do produto" aria-label="Nome do produto para adicionar" data-testid="input-list-product" />
          <input className="field quantity" type="number" min="1" step="1" value={quantity} aria-label="Quantidade para adicionar" onChange={e => setQuantity(Math.max(1, Number(e.target.value)))} data-testid="input-list-quantity" />
          <button className="button" type="submit" disabled={add.isPending} aria-label="Adicionar produto à lista" data-testid="button-add-list-item">{add.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={17} />}</button>
        </form>
        {formError && <div className="status-message status-error" role="alert" data-testid="status-list-error">{formError}</div>}
        {add.isError && <div className="status-message status-error" role="alert">Não foi possível adicionar o produto. Tente novamente.</div>}
        {list.isLoading ? <div style={{ display: 'grid', gap: 9 }}><div className="skeleton" /><div className="skeleton" /></div> :
          list.isError ? <StateError retry={() => list.refetch()} /> :
            data?.items.length ? <div>{data.items.map(item => <div className="shopping-item" key={item.id} data-testid={`row-list-item-${item.id}`}><span className="item-name">{item.productName}</span><div className="quantity-control" aria-label={`Quantidade de ${item.productName}`}><button onClick={() => changeQuantity(item.id, item.quantity, -1)} disabled={update.isPending || item.quantity <= 1} aria-label={`Diminuir quantidade de ${item.productName}`} data-testid={`button-decrease-${item.id}`}><Minus size={13} /></button><span data-testid={`text-quantity-${item.id}`}>{item.quantity}</span><button onClick={() => changeQuantity(item.id, item.quantity, 1)} disabled={update.isPending} aria-label={`Aumentar quantidade de ${item.productName}`} data-testid={`button-increase-${item.id}`}><Plus size={13} /></button></div><button className="button ghost danger" onClick={() => remove.mutate({ id: item.id })} disabled={remove.isPending} aria-label={`Remover ${item.productName}`} data-testid={`button-remove-list-item-${item.id}`}><Trash2 size={15} /></button></div>)}</div> :
              <EmptyState title="Sua lista está vazia" copy="Adicione o que precisa comprar. Depois, compare o total estimado em cada supermercado." icon={ShoppingBasket} />}
        {remove.isError && <div className="status-message status-error" role="alert">Não foi possível remover o item. Tente novamente.</div>}
      </section>
      <section className="surface panel">
        <h2 className="panel-heading">Onde vale mais a pena?</h2><p className="panel-desc">Totais com base nas ofertas cadastradas para os itens da sua lista.</p>
        {list.isLoading ? <div style={{ display: 'grid', gap: 11 }}><div className="skeleton" /><div className="skeleton" /></div> :
          list.isError ? <StateError retry={() => list.refetch()} /> :
            !data?.items.length ? <EmptyState title="Ainda sem comparação" copy="Quando sua lista tiver produtos, mostramos cobertura e total por supermercado." icon={TrendingDown} /> :
              !storeTotals.length ? <EmptyState title="Sem preços para comparar" copy="Ainda não há preços cadastrados para estes produtos. Confira novamente depois de novos folhetos ou notas fiscais." icon={PackageSearch} /> :
                <>
                  {bestStore && <div className="status-message status-success" data-testid="status-best-store"><Check size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{complete.length ? `Menor total com a lista completa: ${bestStore.supermarket}` : `Menor total parcial: ${bestStore.supermarket}`}</div>}
                  {storeTotals.slice().sort((a, b) => a.total - b.total).map((store, index) => <div className={`store-total ${store.supermarket === bestStore?.supermarket ? 'cheapest' : ''}`} key={`${store.supermarket}-${index}`} data-testid={`store-total-${index}`}><div><div className="store-name">{store.supermarket}{store.supermarket === bestStore?.supermarket && <span style={{ marginLeft: 8, color: '#5b8660', fontSize: 9, letterSpacing: '.7px', textTransform: 'uppercase' }}>melhor opção</span>}</div><div className="store-note">{store.coveredItems} de {store.coveredItems + store.missingItems} itens cobertos · {store.missingItems} sem preço</div></div><div className="store-price">{currency(store.total)}</div></div>)}
                  {complete.length === 0 && <div className="status-message status-info">Nenhum mercado tem todos os itens. O menor valor acima considera apenas os produtos cobertos.</div>}
                </>}
      </section>
    </div>
  </div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return <Shell><RoutedErrorBoundary><Switch>
    <Route path="/" component={CatalogPage} />
    <Route path="/encartes" component={FlyersPage} />
    <Route path="/lista" component={ShoppingListPage} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
