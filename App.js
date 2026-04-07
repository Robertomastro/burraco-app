// Burraco Score - UI minimalista con swipe foto ↔ griglia
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Image, SafeAreaView,
  Dimensions, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';

const { width: SW, height: SH } = Dimensions.get('window');

const CHIAVE_STORAGE = 'anthropic_api_key';
const TABELLE_STORAGE = 'tabelle_vp';
const TABELLA_ATTIVA_STORAGE = 'tabella_attiva';
const SMAZZATE = 4;

// ── Tabelle predefinite ───────────────────────────────────────────────────────
const TABELLA_DEFAULT = {
  id: 'default', nome: 'Standard APS',
  righe: [
    { min: 0,    max: 100,   vpV: 10, vpP: 10 },
    { min: 105,  max: 300,   vpV: 11, vpP: 9  },
    { min: 305,  max: 500,   vpV: 12, vpP: 8  },
    { min: 505,  max: 700,   vpV: 13, vpP: 7  },
    { min: 705,  max: 900,   vpV: 14, vpP: 6  },
    { min: 905,  max: 1100,  vpV: 15, vpP: 5  },
    { min: 1105, max: 1300,  vpV: 16, vpP: 4  },
    { min: 1305, max: 1500,  vpV: 17, vpP: 3  },
    { min: 1505, max: 1700,  vpV: 18, vpP: 2  },
    { min: 1705, max: 2000,  vpV: 19, vpP: 1  },
    { min: 2005, max: 99999, vpV: 20, vpP: 0  },
  ],
};
const TABELLA_A_SQUADRE = {
  id: 'a_squadre', nome: 'A squadre',
  righe: [
    { min: 0,    max: 150,   vpV: 10, vpP: 10 },
    { min: 155,  max: 350,   vpV: 11, vpP: 9  },
    { min: 355,  max: 550,   vpV: 12, vpP: 8  },
    { min: 555,  max: 800,   vpV: 13, vpP: 7  },
    { min: 805,  max: 1050,  vpV: 14, vpP: 6  },
    { min: 1055, max: 1300,  vpV: 15, vpP: 5  },
    { min: 1305, max: 1600,  vpV: 16, vpP: 4  },
    { min: 1605, max: 1900,  vpV: 17, vpP: 3  },
    { min: 1905, max: 2200,  vpV: 18, vpP: 2  },
    { min: 2205, max: 2500,  vpV: 19, vpP: 1  },
    { min: 2505, max: 99999, vpV: 20, vpP: 0  },
  ],
};
const TABELLE_DEFAULT = [TABELLA_DEFAULT, TABELLA_A_SQUADRE];

function calcolaVPdaTabella(tabella, diff) {
  const d = Math.abs(diff);
  const r = tabella.righe.find(r => d >= r.min && d <= r.max);
  if (!r) return null;
  return diff >= 0 ? { vpA: r.vpV, vpB: r.vpP } : { vpA: r.vpP, vpB: r.vpV };
}

function parseValore(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s || s === '-' || s === '/' || s === '—' || s === '–') return 0;
  if (/^\d+-$/.test(s)) return -parseInt(s, 10);
  const n = parseInt(s.replace(/[^0-9\-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// ── Prompt OCR con chain-of-thought ──────────────────────────────────────────
const SYSTEM_PROMPT = `Leggi questo segnapunti di Burraco scritto a mano. Due colonne: A sinistra, B destra. 4 mani. Ogni mano: BASE, PUNTI, TOTALE. In fondo: VP per A e B.

REGOLA BASE: il valore e' sempre un multiplo di 50. Se vedi qualcosa di ambiguo scegli il multiplo di 50 piu' vicino visivamente. Non usare mai la somma per trovarlo.
REGOLA PUNTI: il valore e' sempre un multiplo di 5. Se ambiguo scegli il multiplo di 5 piu' vicino visivamente. Non usare mai la somma per trovarlo.
REGOLA TOTALE: leggi ESATTAMENTE cio' che e' scritto. NON calcolare. NON sommare. Solo leggere.
REGOLA SEGNO: trattino o slash isolato = 0. Numero con "-" prima o dopo = negativo.

CIFRE AMBIGUE nella scrittura a mano:
1 e 7 si confondono (usa il vincolo multiplo per disambiguare)
0 e 6 si confondono
3 e 8 si confondono  
4 e 9 si confondono
Studia ogni cifra nel contesto della cella.

Rispondi SOLO con questo JSON compilato, zero testo aggiuntivo:
{"nomiA":["",""],"nomiB":["",""],"smazzate":[{"a":{"base":0,"punti":0,"totale":0},"b":{"base":0,"punti":0,"totale":0}},{"a":{"base":0,"punti":0,"totale":0},"b":{"base":0,"punti":0,"totale":0}},{"a":{"base":0,"punti":0,"totale":0},"b":{"base":0,"punti":0,"totale":0}},{"a":{"base":0,"punti":0,"totale":0},"b":{"base":0,"punti":0,"totale":0}}],"vpA":0,"vpB":0}`;

// ── Preprocessing: invia originale ad alta qualità senza ridimensionamento ────
async function preprocessImmagine(uri) {
  try {
    // Non ridimensioniamo: più pixel = più dettaglio sulla scrittura a mano
    // Convertiamo solo in JPEG con qualità massima per coerenza
    const risultato = await ImageManipulator.manipulateAsync(
      uri,
      [], // nessuna trasformazione geometrica
      { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG }
    );
    return risultato.uri;
  } catch (_) {
    return uri;
  }
}

async function estraiDatiDaFoto(uri, apiKey) {
  const uriProcessato = await preprocessImmagine(uri);
  const base64 = await FileSystem.readAsStringAsync(uriProcessato, { encoding: FileSystem.EncodingType.Base64 });
  const risposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: 'JSON:' },
      ]}],
    }),
  });
  if (!risposta.ok) {
    const err = await risposta.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Errore API: ${risposta.status}`);
  }
  const dati = await risposta.json();
  const testo = dati.content.find(b => b.type === 'text')?.text ?? '';
  const match = testo.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Risposta OCR non valida');
  return JSON.parse(match[0]);
}

// ── Logica verifica ───────────────────────────────────────────────────────────
function verificaColonna(righe, etichetta) {
  const errori = []; let totPrec = 0;
  righe.forEach((r, i) => {
    const b = Number(r.base) || 0; const p = Number(r.punti) || 0; const t = Number(r.totale);
    const atteso = totPrec + b + p;
    if (r.base === '' && r.punti === '' && r.totale === '') return;
    if (t !== atteso) errori.push({ smazzata: i + 1, colonna: etichetta, scritto: t, atteso });
    totPrec = atteso;
  });
  return errori;
}

function validaValori(righe, etichetta) {
  const errori = [];
  righe.forEach((r, i) => {
    if (r.base !== '' && r.base !== '0' && Math.abs(Number(r.base)) % 50 !== 0)
      errori.push({ smazzata: i + 1, colonna: etichetta, tipo: 'BASE', valore: r.base });
    if (r.punti !== '' && r.punti !== '0' && Math.abs(Number(r.punti)) % 5 !== 0)
      errori.push({ smazzata: i + 1, colonna: etichetta, tipo: 'PUNTI', valore: r.punti });
  });
  return errori;
}

// ── Campo compatto con +/- colorato ──────────────────────────────────────────
function C({ value, onChange, errore, warn, bold }) {
  const isNeg = value?.startsWith('-');
  const toggleSegno = () => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n !== 0) onChange(String(-n));
  };
  return (
    <View style={g.cellWrap}>
      <TouchableOpacity onPress={toggleSegno} style={[g.segnoBtn, isNeg ? g.segnoBtnNeg : g.segnoBtnPos]}>
        <Text style={g.segnoT}>{isNeg ? '−' : '+'}</Text>
      </TouchableOpacity>
      <TextInput
        keyboardType="number-pad"
        value={value?.replace('-', '') ?? ''}
        onChangeText={v => {
          const cifre = v.replace(/[^0-9]/g, '');
          const neg = value?.startsWith('-');
          onChange(cifre === '' ? '' : (neg ? '-' + cifre : cifre));
        }}
        style={[g.cellInput, errore && g.cellErr, warn && !errore && g.cellWarn, bold && g.cellBold]}
        placeholder="—"
        placeholderTextColor="#bbb"
        selectTextOnFocus
      />
    </View>
  );
}

// ── Griglia punteggi compatta ─────────────────────────────────────────────────
function Griglia({ datiA, datiB, vpA, vpB, onChangeA, onChangeB, onChangeVpA, onChangeVpB, risultato, tabella, nomiA, nomiB }) {
  const ris = risultato;
  const totA = Number(datiA[3]?.totale) || 0;
  const totB = Number(datiB[3]?.totale) || 0;
  const diff = totA - totB;
  const vpCalc = tabella ? calcolaVPdaTabella(tabella, diff) : null;

  const ROW_H = 32;
  const HEADER_H = 28;

  const coloreRiga = (i) => i % 2 === 0 ? '#fff' : '#fafaf7';

  const rigaHeader = (
    <View style={[g.riga, { minHeight: HEADER_H, backgroundColor: '#1a1a2e', paddingVertical: 4 }]}>
      <View style={g.labelCol} />
      <View style={g.colA}>
        {nomiA.filter(Boolean).map((n, i) => <Text key={i} style={g.headerNome} numberOfLines={1}>{n}</Text>)}
        {!nomiA.filter(Boolean).length && <Text style={g.headerNome}>A</Text>}
      </View>
      <View style={g.colB}>
        {nomiB.filter(Boolean).map((n, i) => <Text key={i} style={g.headerNome} numberOfLines={1}>{n}</Text>)}
        {!nomiB.filter(Boolean).length && <Text style={g.headerNome}>B</Text>}
      </View>
    </View>
  );

  const separatoreMano = (idx) => (
    <View key={`sep${idx}`} style={g.separatoreMano}>
      <Text style={g.separatoreT}>M{idx + 1}</Text>
    </View>
  );

  const rigaDati = (label, valA, valB, onA, onB, errA, errB, warnA, warnB, isBold, bgColor) => (
    <View style={[g.riga, { height: ROW_H, backgroundColor: bgColor }]}>
      <View style={g.labelCol}><Text style={[g.labelT, isBold && { fontWeight: 'bold', color: '#1a1a2e' }]}>{label}</Text></View>
      <View style={g.colA}><C value={valA} onChange={onA} errore={errA} warn={warnA} bold={isBold} /></View>
      <View style={g.colB}><C value={valB} onChange={onB} errore={errB} warn={warnB} bold={isBold} /></View>
    </View>
  );

  const rigaStatica = (label, valA, valB, colorA, colorB, bgColor) => (
    <View style={[g.riga, { height: ROW_H, backgroundColor: bgColor }]}>
      <View style={g.labelCol}><Text style={g.labelT}>{label}</Text></View>
      <View style={g.colA}><Text style={[g.staticVal, colorA && { color: colorA }]}>{valA}</Text></View>
      <View style={g.colB}><Text style={[g.staticVal, colorB && { color: colorB }]}>{valB}</Text></View>
    </View>
  );

  const mani = [];
  for (let i = 0; i < SMAZZATE; i++) {
    const errA = ris?.indiciErrA?.includes(i);
    const errB = ris?.indiciErrB?.includes(i);
    const wA = ris?.warnA ?? [];
    const wB = ris?.warnB ?? [];
    const bg1 = i % 2 === 0 ? '#fff' : '#fafaf7';
    const bg2 = i % 2 === 0 ? '#f9f6f0' : '#f4f1ea';
    // Sottile separatore tra mani (tranne prima)
    if (i > 0) mani.push(<View key={`div${i}`} style={g.divider} />);
    mani.push(
      <View key={`m${i}`}>
        {rigaDati('BASE',
          datiA[i].base, datiB[i].base,
          v => onChangeA(i, 'base', v), v => onChangeB(i, 'base', v),
          false, false,
          wA.some(w => w.smazzata === i+1 && w.tipo === 'BASE'),
          wB.some(w => w.smazzata === i+1 && w.tipo === 'BASE'),
          false, bg1)}
        {rigaDati('PUNTI',
          datiA[i].punti, datiB[i].punti,
          v => onChangeA(i, 'punti', v), v => onChangeB(i, 'punti', v),
          false, false,
          wA.some(w => w.smazzata === i+1 && w.tipo === 'PUNTI'),
          wB.some(w => w.smazzata === i+1 && w.tipo === 'PUNTI'),
          false, bg1)}
        {rigaDati('TOT',
          datiA[i].totale, datiB[i].totale,
          v => onChangeA(i, 'totale', v), v => onChangeB(i, 'totale', v),
          errA, errB, false, false, true, bg2)}
      </View>
    );
  }

  // Riepilogo
  const diffA = diff > 0 ? String(diff) : '';
  const diffB = diff < 0 ? String(Math.abs(diff)) : '';

  return (
    <View style={g.griglia}>
      {rigaHeader}
      {mani}
      <View style={g.dividerRiepilogo} />
      {rigaStatica('TOT.', String(totA), String(totB), '#2c5f2e', '#7a2230', '#fff')}
      {rigaStatica('DIFF.', diffA, diffB, '#2c5f2e', '#7a2230', '#f9f6f0')}
      {rigaDati('V.P.', vpA, vpB,
        onChangeVpA, onChangeVpB,
        ris?.erroriRiepilogo?.vpA, ris?.erroriRiepilogo?.vpB,
        false, false, true, '#fff')}
      {vpCalc && rigaStatica('V.P.✓', String(vpCalc.vpA), String(vpCalc.vpB), '#2c5f2e', '#7a2230', '#eafaf1')}
    </View>
  );
}

// ── Pannello risultato compatto ───────────────────────────────────────────────
function PannelloRisultato({ risultato }) {
  if (!risultato) return null;
  const ris = risultato;
  if (ris.ok) return (
    <View style={[r.box, r.boxOk]}>
      <Text style={r.ok}>✓ Tutto corretto</Text>
    </View>
  );
  return (
    <View style={[r.box, r.boxErr]}>
      <Text style={r.errTitolo}>✗ {ris.errori.length === 1 ? '1 errore' : `${ris.errori.length} errori`}</Text>
      {ris.errori.map((e, i) => (
        <Text key={i} style={r.errRiga}>
          {e.colonna ? `[${e.colonna}] M${e.smazzata}: scritto ${e.scritto}, atteso ${e.atteso}` : e.desc}
        </Text>
      ))}
    </View>
  );
}

// ── Editor Tabella ────────────────────────────────────────────────────────────
function EditorTabella({ tabella, onSalva, onAnnulla }) {
  const [nome, setNome] = useState(tabella?.nome ?? '');
  const [righe, setRighe] = useState(
    tabella?.righe.map(r => ({ min: String(r.min), max: r.max === 99999 ? '' : String(r.max), vpV: String(r.vpV), vpP: String(r.vpP) }))
    ?? [{ min: '0', max: '100', vpV: '10', vpP: '10' }]
  );
  const upd = (i, k, v) => setRighe(p => { const c = [...p]; c[i] = { ...c[i], [k]: v }; return c; });
  const salva = () => {
    if (!nome.trim()) { Alert.alert('Errore', 'Nome mancante.'); return; }
    onSalva({ id: tabella?.id ?? String(Date.now()), nome: nome.trim(), righe: righe.map(r => ({ min: parseInt(r.min)||0, max: r.max===''?99999:parseInt(r.max)||0, vpV: parseInt(r.vpV)||0, vpP: parseInt(r.vpP)||0 })) });
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5efe6' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={imp.titolo}>Editor Tabella VP</Text>
        <TextInput style={imp.inputNome} value={nome} onChangeText={setNome} placeholder="Nome tabella" placeholderTextColor="#9a8a75" />
        <View style={{ flexDirection: 'row', marginVertical: 8 }}>
          {['Da','A','VP Vin.','VP Per.',''].map((h,i) => <Text key={i} style={[imp.th, i<4?{flex:i<2?1.2:1}:{width:28}]}>{h}</Text>)}
        </View>
        {righe.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 6, gap: 4, alignItems: 'center' }}>
            {['min','max','vpV','vpP'].map((k,j) => <TextInput key={k} style={[imp.inputTh, j<2?{flex:1.2}:{flex:1}]} value={r[k]} onChangeText={v => upd(i,k,v)} keyboardType="number-pad" placeholder={k==='max'?'∞':'0'} placeholderTextColor="#bbb" />)}
            <TouchableOpacity onPress={() => setRighe(p => p.filter((_,idx) => idx!==i))} style={{ width: 28, alignItems: 'center' }}><Text style={{ color: '#e74c3c', fontWeight: 'bold' }}>✕</Text></TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={imp.btnAdd} onPress={() => setRighe(p => [...p, { min:'',max:'',vpV:'',vpP:'' }])}><Text style={{ color: '#d4af37', fontWeight: 'bold' }}>+ Aggiungi fascia</Text></TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <TouchableOpacity style={[imp.btn, { flex: 1, borderWidth: 1.5, borderColor: '#c8b89a' }]} onPress={onAnnulla}><Text style={{ color: '#7a6a55' }}>Annulla</Text></TouchableOpacity>
          <TouchableOpacity style={[imp.btn, { flex: 2, backgroundColor: '#1a1a2e' }]} onPress={salva}><Text style={{ color: '#d4af37', fontWeight: 'bold' }}>Salva tabella</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Impostazioni ──────────────────────────────────────────────────────────────
function SchermatImpostazioni({ onTorna }) {
  const [apiKey, setApiKey] = useState('');
  const [salvata, setSalvata] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tabelle, setTabelle] = useState(TABELLE_DEFAULT);
  const [tabellaAttivaId, setTabellaAttivaId] = useState('default');
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    (async () => {
      const k = await SecureStore.getItemAsync(CHIAVE_STORAGE);
      if (k) { setApiKey(k); setSalvata(true); }
      const t = await SecureStore.getItemAsync(TABELLE_STORAGE);
      if (t) { try { setTabelle(JSON.parse(t)); } catch (_) {} } else { setTabelle(TABELLE_DEFAULT); }
      const ta = await SecureStore.getItemAsync(TABELLA_ATTIVA_STORAGE);
      if (ta) setTabellaAttivaId(ta);
      setLoading(false);
    })();
  }, []);

  const salvaApiKey = async () => {
    const p = apiKey.trim();
    if (!p.startsWith('sk-ant-')) { Alert.alert('Chiave non valida', 'Deve iniziare con "sk-ant-".'); return; }
    await SecureStore.setItemAsync(CHIAVE_STORAGE, p); setSalvata(true); Alert.alert('Salvata', 'API key salvata.');
  };
  const eliminaApiKey = async () => Alert.alert('Elimina chiave', 'Sei sicuro?', [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Elimina', style: 'destructive', onPress: async () => { await SecureStore.deleteItemAsync(CHIAVE_STORAGE); setApiKey(''); setSalvata(false); } },
  ]);
  const salvaTabelle = async (nuove) => { setTabelle(nuove); await SecureStore.setItemAsync(TABELLE_STORAGE, JSON.stringify(nuove)); };
  const salvaTabellaAttiva = async (id) => { setTabellaAttivaId(id); await SecureStore.setItemAsync(TABELLA_ATTIVA_STORAGE, id); };
  const onSalvaTabella = async (tab) => {
    const nuove = tabelle.find(t => t.id === tab.id) ? tabelle.map(t => t.id === tab.id ? tab : t) : [...tabelle, tab];
    await salvaTabelle(nuove); setEditor(null);
  };
  const eliminaTabella = (id) => {
    if (id === 'default' || id === 'a_squadre') { Alert.alert('Errore', 'Le tabelle predefinite non possono essere eliminate.'); return; }
    Alert.alert('Elimina', 'Sei sicuro?', [{ text: 'Annulla', style: 'cancel' }, { text: 'Elimina', style: 'destructive', onPress: async () => { const n = tabelle.filter(t => t.id !== id); await salvaTabelle(n); if (tabellaAttivaId === id) await salvaTabellaAttiva('default'); } }]);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5efe6' }}><ActivityIndicator color="#d4af37" size="large" /></View>;
  if (editor !== null) return <EditorTabella tabella={editor === 'nuova' ? null : editor} onSalva={onSalvaTabella} onAnnulla={() => setEditor(null)} />;

  const tabAttiva = tabelle.find(t => t.id === tabellaAttivaId) ?? TABELLA_DEFAULT;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5efe6' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={imp.titolo}>Impostazioni</Text>

        <Text style={imp.sezione}>API KEY ANTHROPIC</Text>
        <Text style={imp.sub}>Necessaria per l'OCR delle foto. console.anthropic.com</Text>
        <TextInput style={imp.inputNome} value={apiKey} onChangeText={v => { setApiKey(v); setSalvata(false); }} placeholder="sk-ant-..." placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
        {salvata && <Text style={imp.ok}>✓ Chiave attiva</Text>}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <TouchableOpacity style={[imp.btn, { flex: 2, backgroundColor: '#1a1a2e' }]} onPress={salvaApiKey}><Text style={{ color: '#d4af37', fontWeight: 'bold' }}>Salva chiave</Text></TouchableOpacity>
          {salvata && <TouchableOpacity style={[imp.btn, { flex: 1, borderWidth: 1.5, borderColor: '#e74c3c' }]} onPress={eliminaApiKey}><Text style={{ color: '#e74c3c' }}>Elimina</Text></TouchableOpacity>}
        </View>

        <Text style={[imp.sezione, { marginTop: 24 }]}>TABELLE VICTORY POINTS</Text>
        {tabelle.map(t => (
          <View key={t.id} style={imp.rigaTabella}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }} onPress={() => salvaTabellaAttiva(t.id)}>
              <View style={[imp.radio, tabellaAttivaId === t.id && imp.radioOn]} />
              <Text style={[imp.nomeTab, tabellaAttivaId === t.id && { color: '#1a1a2e', fontWeight: 'bold' }]}>{t.nome}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TouchableOpacity onPress={() => setEditor(t)} style={imp.btnTab}><Text style={{ color: '#7a6a55', fontSize: 12 }}>✏</Text></TouchableOpacity>
              {t.id !== 'default' && t.id !== 'a_squadre' && <TouchableOpacity onPress={() => eliminaTabella(t.id)} style={imp.btnTab}><Text style={{ color: '#e74c3c', fontSize: 12 }}>✕</Text></TouchableOpacity>}
            </View>
          </View>
        ))}

        <Text style={[imp.sub, { marginTop: 12, marginBottom: 6 }]}>Fasce: {tabAttiva.nome}</Text>
        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {['Differenza','VP Vin.','VP Per.'].map((h,i) => <Text key={i} style={[imp.th, i===0?{flex:2}:{flex:1}]}>{h}</Text>)}
        </View>
        {tabAttiva.righe.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#f0e8d8', backgroundColor: i%2===0?'#fff':'#fdfaf5' }}>
            <Text style={[imp.td, { flex: 2 }]}>{r.min} – {r.max === 99999 ? '2505+' : r.max}</Text>
            <Text style={[imp.td, { flex: 1, color: '#2c5f2e', fontWeight: 'bold' }]}>{r.vpV}</Text>
            <Text style={[imp.td, { flex: 1, color: '#7a2230', fontWeight: 'bold' }]}>{r.vpP}</Text>
          </View>
        ))}

        <TouchableOpacity style={[imp.btn, { backgroundColor: '#1a1a2e', marginTop: 14 }]} onPress={() => setEditor('nuova')}>
          <Text style={{ color: '#d4af37', fontWeight: 'bold' }}>+ Nuova tabella</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={onTorna}>
          <Text style={{ color: '#7a6a55', fontSize: 14 }}>← Torna all'app</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── App principale ────────────────────────────────────────────────────────────
function SchermatHome({ onImpostazioni }) {
  const vuoto = () => Array.from({ length: SMAZZATE }, () => ({ base: '', punti: '', totale: '' }));
  const [nomiA, setNomiA] = useState(['', '']);
  const [nomiB, setNomiB] = useState(['', '']);
  const [datiA, setDatiA] = useState(vuoto());
  const [datiB, setDatiB] = useState(vuoto());
  const [vpA, setVpA] = useState('');
  const [vpB, setVpB] = useState('');
  const [risultato, setRisultato] = useState(null);
  const [foto, setFoto] = useState(null);
  const [stato, setStato] = useState('idle'); // idle | analisi | errore
  const [erroreMsg, setErroreMsg] = useState('');
  const [apiKey, setApiKey] = useState(null);
  const [tabella, setTabella] = useState(TABELLA_DEFAULT);
  const [pagina, setPagina] = useState(1); // 0=foto, 1=griglia
  const pagerRef = useRef(null);

  useEffect(() => {
    const carica = async () => {
      const k = await SecureStore.getItemAsync(CHIAVE_STORAGE);
      setApiKey(k ?? null);
      const t = await SecureStore.getItemAsync(TABELLE_STORAGE);
      const tabs = t ? JSON.parse(t) : TABELLE_DEFAULT;
      const ta = await SecureStore.getItemAsync(TABELLA_ATTIVA_STORAGE) ?? 'default';
      setTabella(tabs.find(x => x.id === ta) ?? TABELLA_DEFAULT);
    };
    carica();
    const timer = setInterval(carica, 2000);
    return () => clearInterval(timer);
  }, []);

  const calcolaRisultato = useCallback((a, b, vA, vB, tab) => {
    const errori = []; const indiciErrA = []; const indiciErrB = [];
    verificaColonna(a, 'A').forEach(e => { errori.push(e); indiciErrA.push(e.smazzata - 1); });
    verificaColonna(b, 'B').forEach(e => { errori.push(e); indiciErrB.push(e.smazzata - 1); });
    const wA = validaValori(a, 'A'); const wB = validaValori(b, 'B');
    wA.forEach(w => errori.push({ desc: `M${w.smazzata} Coppia A: ${w.tipo} "${w.valore}" non è multiplo valido` }));
    wB.forEach(w => errori.push({ desc: `M${w.smazzata} Coppia B: ${w.tipo} "${w.valore}" non è multiplo valido` }));
    const totA = Number(a[3]?.totale) || 0; const totB = Number(b[3]?.totale) || 0;
    const vpCalcolati = tab ? calcolaVPdaTabella(tab, totA - totB) : null;
    const erroriRiepilogo = { vpA: false, vpB: false };
    if (vpCalcolati && vA !== '' && Number(vA) !== vpCalcolati.vpA) { errori.push({ desc: `VP A: scritto ${vA}, atteso ${vpCalcolati.vpA}` }); erroriRiepilogo.vpA = true; }
    if (vpCalcolati && vB !== '' && Number(vB) !== vpCalcolati.vpB) { errori.push({ desc: `VP B: scritto ${vB}, atteso ${vpCalcolati.vpB}` }); erroriRiepilogo.vpB = true; }
    return { ok: errori.length === 0, errori, indiciErrA, indiciErrB, erroriRiepilogo, warnA: wA, warnB: wB };
  }, []);

  useEffect(() => {
    const hasDati = datiA.some(r => r.base !== '' || r.punti !== '' || r.totale !== '') ||
                    datiB.some(r => r.base !== '' || r.punti !== '' || r.totale !== '');
    if (hasDati) setRisultato(calcolaRisultato(datiA, datiB, vpA, vpB, tabella));
    else setRisultato(null);
  }, [datiA, datiB, vpA, vpB, tabella]);

  const aggiorna = useCallback((setter, idx, campo, val) => {
    setter(prev => { const c = prev.map(r => ({ ...r })); c[idx][campo] = val; return c; });
  }, []);

  const controllaApiKey = () => {
    if (!apiKey) { Alert.alert('API Key mancante', 'Configurala nelle impostazioni.', [{ text: 'Impostazioni', onPress: onImpostazioni }, { text: 'Annulla' }]); return false; }
    return true;
  };

  const salvaInAlbumBurraco = async (uri) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') return;
      const asset = await MediaLibrary.createAssetAsync(uri);
      let album = await MediaLibrary.getAlbumAsync('Burraco');
      if (!album) await MediaLibrary.createAlbumAsync('Burraco', asset, false);
      else await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    } catch (_) {}
  };

  const elaboraFoto = async (uri) => {
    setFoto(uri);
    setStato('analisi');
    setRisultato(null);
    setErroreMsg('');
    // Vai sulla pagina foto per vedere l'anteprima durante l'analisi
    pagerRef.current?.scrollTo({ x: 0, animated: true });
    setPagina(0);
    try {
      const dati = await estraiDatiDaFoto(uri, apiKey);
      const toStr = v => String(parseValore(v));
      const nA = dati.smazzate.map(sm => ({ base: toStr(sm.a.base), punti: toStr(sm.a.punti), totale: toStr(sm.a.totale) }));
      const nB = dati.smazzate.map(sm => ({ base: toStr(sm.b.base), punti: toStr(sm.b.punti), totale: toStr(sm.b.totale) }));
      setNomiA(dati.nomiA?.length ? dati.nomiA : ['', '']);
      setNomiB(dati.nomiB?.length ? dati.nomiB : ['', '']);
      setDatiA(nA); setDatiB(nB);
      setVpA(toStr(dati.vpA)); setVpB(toStr(dati.vpB));
      setStato('idle');
      // Vai alla griglia dopo l'analisi
      setTimeout(() => {
        pagerRef.current?.scrollTo({ x: SW, animated: true });
        setPagina(1);
      }, 400);
    } catch (e) {
      setStato('errore');
      setErroreMsg(e.message);
    }
  };

  const scattaFoto = async () => {
    if (!controllaApiKey()) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permesso negato', "Consenti l'accesso alla fotocamera."); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1.0, base64: false });
    if (!res.canceled && res.assets?.[0]?.uri) {
      // La fotocamera Android salva già in DCIM automaticamente
      // Non serve salvaInAlbumBurraco — evita il dialogo "modifica foto"
      elaboraFoto(res.assets[0].uri);
    }
  };

  const caricaDaLibreria = async () => {
    if (!controllaApiKey()) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permesso negato', "Consenti l'accesso alla galleria."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1.0, base64: false });
    if (!res.canceled && res.assets?.[0]?.uri) elaboraFoto(res.assets[0].uri);
  };

  const reset = () => {
    setDatiA(vuoto()); setDatiB(vuoto()); setNomiA(['', '']); setNomiB(['', '']);
    setVpA(''); setVpB(''); setRisultato(null); setFoto(null); setStato('idle'); setErroreMsg('');
    pagerRef.current?.scrollTo({ x: SW, animated: true }); setPagina(1);
  };

  // Header compatto
  const header = (
    <View style={h.header}>
      <TouchableOpacity onPress={() => { pagerRef.current?.scrollTo({ x: 0, animated: true }); setPagina(0); }} style={h.btnFoto}>
        <Text style={h.btnFotoT}>📷</Text>
      </TouchableOpacity>
      <Text style={h.titolo}>CONTROLLA PUNTI</Text>
      <TouchableOpacity onPress={onImpostazioni} style={h.btnImp}>
        <Text style={h.btnImpT}>⚙</Text>
      </TouchableOpacity>
    </View>
  );

  // Indicatori pagina
  const indicatori = (
    <View style={h.indicatori}>
      <View style={[h.dot, pagina === 0 && h.dotOn]} />
      <View style={[h.dot, pagina === 1 && h.dotOn]} />
    </View>
  );

  // Pagina 0: foto
  const paginaFoto = (
    <View style={{ width: SW, flex: 1 }}>
      {stato === 'analisi' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
          <ActivityIndicator color="#d4af37" size="large" />
          <Text style={{ color: '#d4af37', marginTop: 12, fontSize: 14 }}>Analisi in corso…</Text>
        </View>
      ) : foto ? (
        <ScrollView
          style={{ flex: 1, backgroundColor: '#000' }}
          contentContainerStyle={{ flex: 1 }}
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <Image source={{ uri: foto }} style={{ width: SW, flex: 1 }} resizeMode="contain" />
        </ScrollView>
      ) : (
        <View style={{ flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
          <TouchableOpacity style={h.btnScanGrande} onPress={scattaFoto}>
            <Text style={{ fontSize: 40 }}>📷</Text>
            <Text style={{ color: '#d4af37', fontSize: 16, fontWeight: 'bold', marginTop: 8 }}>Fotocamera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={h.btnScanGrande} onPress={caricaDaLibreria}>
            <Text style={{ fontSize: 40 }}>🖼</Text>
            <Text style={{ color: '#d4af37', fontSize: 16, fontWeight: 'bold', marginTop: 8 }}>Libreria</Text>
          </TouchableOpacity>
          {stato === 'errore' && <Text style={{ color: '#e74c3c', textAlign: 'center', paddingHorizontal: 24, fontSize: 13 }}>⚠ {erroreMsg}</Text>}
        </View>
      )}
      {foto && stato !== 'analisi' && (
        <View style={h.fotoBar}>
          <TouchableOpacity style={h.btnFotoBar} onPress={scattaFoto}><Text style={h.btnFotoBarT}>📷 Nuova</Text></TouchableOpacity>
          <TouchableOpacity style={h.btnFotoBar} onPress={caricaDaLibreria}><Text style={h.btnFotoBarT}>🖼 Libreria</Text></TouchableOpacity>
          <TouchableOpacity style={[h.btnFotoBar, { borderColor: '#7a6a55' }]} onPress={reset}><Text style={[h.btnFotoBarT, { color: '#7a6a55' }]}>↺ Reset</Text></TouchableOpacity>
        </View>
      )}
    </View>
  );

  // Pagina 1: griglia
  const paginaGriglia = (
    <View style={{ width: SW, flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text style={{ fontSize: 10, color: '#9a8a75', letterSpacing: 1 }}>VP: {tabella.nome}</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={reset} style={{ paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#c8b89a', borderRadius: 8 }}>
            <Text style={{ color: '#7a6a55', fontSize: 12 }}>↺ Reset</Text>
          </TouchableOpacity>
        </View>
        <Griglia
          datiA={datiA} datiB={datiB} vpA={vpA} vpB={vpB}
          onChangeA={(i, k, v) => aggiorna(setDatiA, i, k, v)}
          onChangeB={(i, k, v) => aggiorna(setDatiB, i, k, v)}
          onChangeVpA={v => setVpA(v)} onChangeVpB={v => setVpB(v)}
          risultato={risultato} tabella={tabella}
          nomiA={nomiA} nomiB={nomiB}
        />
        <PannelloRisultato risultato={risultato} />
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5efe6' }}>
      <StatusBar style="light" />
      {header}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setPagina(Math.round(e.nativeEvent.contentOffset.x / SW))}
        style={{ flex: 1 }}
        scrollEventThrottle={16}
        nestedScrollEnabled
      >
        {paginaFoto}
        {paginaGriglia}
      </ScrollView>
      {indicatori}
    </SafeAreaView>
  );
}

export default function App() {
  const [schermata, setSchermata] = useState('home');
  if (schermata === 'impostazioni') return <SchermatImpostazioni onTorna={() => setSchermata('home')} />;
  return <SchermatHome onImpostazioni={() => setSchermata('impostazioni')} />;
}

// ── Stili griglia ─────────────────────────────────────────────────────────────
const g = StyleSheet.create({
  griglia: { marginHorizontal: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#ddd0b8' },
  riga: { flexDirection: 'row', alignItems: 'center' },
  labelCol: { width: 46, paddingLeft: 6, justifyContent: 'center' },
  labelT: { fontSize: 9, color: '#9a8a75', letterSpacing: 0.5, textTransform: 'uppercase' },
  colA: { flex: 1, borderLeftWidth: 1, borderLeftColor: '#e8e0d0', paddingHorizontal: 3, justifyContent: 'center' },
  colB: { flex: 1, borderLeftWidth: 1, borderLeftColor: '#e8e0d0', paddingHorizontal: 3, justifyContent: 'center' },
  headerNome: { fontSize: 11, color: '#d4af37', fontWeight: 'bold', textAlign: 'center', letterSpacing: 0.3 },
  divider: { height: 2, backgroundColor: '#2a2a3e' },
  dividerRiepilogo: { height: 3, backgroundColor: '#1a1a2e' },
  cellWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  segnoBtn: { width: 20, height: 28, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  segnoBtnPos: { backgroundColor: '#2c5f2e' },
  segnoBtnNeg: { backgroundColor: '#7a2230' },
  segnoT: { color: '#fff', fontSize: 14, lineHeight: 18, fontWeight: 'bold' },
  cellInput: { flex: 1, fontSize: 17, textAlign: 'center', color: '#2a1e12', borderWidth: 1, borderColor: '#ddd0b8', borderRadius: 4, paddingVertical: 4, paddingHorizontal: 1, backgroundColor: 'transparent' },
  cellErr: { borderColor: '#e74c3c', backgroundColor: '#fff0ee', color: '#c0392b' },
  cellWarn: { borderColor: '#e67e22', backgroundColor: '#fff8ee' },
  cellBold: { fontWeight: 'bold', fontSize: 18 },
  staticVal: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: '#2a1e12' },
});

// ── Stili risultato ───────────────────────────────────────────────────────────
const r = StyleSheet.create({
  box: { margin: 8, borderRadius: 8, padding: 10, borderWidth: 1.5 },
  boxOk: { backgroundColor: '#eafaf1', borderColor: '#2ecc71' },
  boxErr: { backgroundColor: '#fdf0f0', borderColor: '#e74c3c' },
  ok: { color: '#1a6b3a', fontWeight: 'bold', fontSize: 14 },
  errTitolo: { color: '#c0392b', fontWeight: 'bold', fontSize: 13, marginBottom: 6 },
  errRiga: { color: '#5a2020', fontSize: 12, marginBottom: 3 },
});

// ── Stili header e navigazione ────────────────────────────────────────────────
const h = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', paddingHorizontal: 12, paddingVertical: 10 },
  titolo: { flex: 1, textAlign: 'center', color: '#d4af37', fontSize: 14, fontWeight: 'bold', letterSpacing: 2 },
  btnFoto: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  btnFotoT: { fontSize: 20 },
  btnImp: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  btnImpT: { fontSize: 20, color: '#a0a0c0' },
  indicatori: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 6, backgroundColor: '#1a1a2e' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#404060' },
  dotOn: { backgroundColor: '#d4af37', width: 18 },
  fotoBar: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: 'rgba(0,0,0,0.7)' },
  btnFotoBar: { flex: 1, borderWidth: 1, borderColor: '#d4af37', borderRadius: 8, padding: 8, alignItems: 'center' },
  btnFotoBarT: { color: '#d4af37', fontSize: 13 },
  btnScanGrande: { alignItems: 'center', borderWidth: 2, borderColor: '#d4af37', borderStyle: 'dashed', borderRadius: 16, padding: 24, width: SW * 0.6 },
});

// ── Stili impostazioni ────────────────────────────────────────────────────────
const imp = StyleSheet.create({
  titolo: { fontSize: 20, fontWeight: 'bold', color: '#1a1a2e', letterSpacing: 1, marginBottom: 20 },
  sezione: { fontSize: 10, letterSpacing: 2, color: '#9a8a75', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 8 },
  sub: { fontSize: 13, color: '#7a6a55', marginBottom: 10, lineHeight: 18 },
  ok: { color: '#2c5f2e', fontWeight: 'bold', fontSize: 13, marginTop: 6 },
  inputNome: { borderWidth: 1.5, borderColor: '#c8b89a', borderRadius: 8, padding: 12, fontSize: 14, color: '#2a1e12', backgroundColor: '#fffdf8', marginBottom: 4 },
  btn: { borderRadius: 10, padding: 14, alignItems: 'center' },
  rigaTabella: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0e8d8' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#c8b89a', backgroundColor: '#fff' },
  radioOn: { borderColor: '#1a1a2e', backgroundColor: '#1a1a2e' },
  nomeTab: { fontSize: 14, color: '#7a6a55' },
  btnTab: { paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#e8dcc8', borderRadius: 6 },
  th: { fontSize: 10, fontWeight: 'bold', color: '#9a8a75', textTransform: 'uppercase', textAlign: 'center' },
  td: { fontSize: 13, color: '#3a2e22', textAlign: 'center' },
  inputTh: { borderWidth: 1, borderColor: '#c8b89a', borderRadius: 5, padding: 6, fontSize: 13, textAlign: 'center', color: '#2a1e12', backgroundColor: '#fffdf8' },
  btnAdd: { marginTop: 10, padding: 10, borderWidth: 1, borderColor: '#d4af37', borderRadius: 8, alignItems: 'center', borderStyle: 'dashed' },
});
