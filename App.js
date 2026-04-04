// Burraco Score - SDK 52
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Image, SafeAreaView,
  Modal, Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';

const CHIAVE_STORAGE = 'anthropic_api_key';
const TABELLE_STORAGE = 'tabelle_vp';
const TABELLA_ATTIVA_STORAGE = 'tabella_attiva';
const SMAZZATE = 4;

// ── Tabella VP default ────────────────────────────────────────────────────────
const TABELLA_DEFAULT = {
  id: 'default',
  nome: 'Standard APS',
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
  id: 'a_squadre',
  nome: 'A squadre',
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

function calcolaVPdaTabella(tabella, diffCalcolata) {
  const d = Math.abs(diffCalcolata);
  const riga = tabella.righe.find(r => d >= r.min && d <= r.max);
  if (!riga) return null;
  return diffCalcolata >= 0
    ? { vpA: riga.vpV, vpB: riga.vpP }
    : { vpA: riga.vpP, vpB: riga.vpV };
}

function parseValore(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s || s === '-' || s === '/' || s === '—' || s === '–') return 0;
  if (/^\d+-$/.test(s)) return -parseInt(s, 10);
  const n = parseInt(s.replace(/[^0-9\-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// ── Campo numerico con toggle segno +/- ──────────────────────────────────────
function Campo({ value, onChange, errore, warn }) {
  const toggleSegno = () => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n !== 0) onChange(String(-n));
  };

  return (
    <View style={s.campoWrap}>
      <TouchableOpacity onPress={toggleSegno} style={s.btnSegno}>
        <Text style={s.btnSegnoT}>{value && value.startsWith('-') ? '−' : '+'}</Text>
      </TouchableOpacity>
      <TextInput
        keyboardType="number-pad"
        value={value.replace('-', '')}
        onChangeText={v => {
          const cifre = v.replace(/[^0-9]/g, '');
          const negativo = value.startsWith('-');
          onChange(cifre === '' ? '' : (negativo ? '-' + cifre : cifre));
        }}
        style={[s.input, errore && s.inputErr, warn && !errore && s.inputWarn]}
        placeholder="—"
        placeholderTextColor="#bbb"
        selectTextOnFocus
      />
    </View>
  );
}

// ── Blocco singola mano ───────────────────────────────────────────────────────
function BloccoMano({ idx, datiA, datiB, onChangeA, onChangeB, erroriA, erroriB, warnA, warnB }) {
  const righe = [
    { k: 'base',   label: 'BASE'   },
    { k: 'punti',  label: 'PUNTI'  },
    { k: 'totale', label: 'TOTALE' },
  ];
  return (
    <View style={s.blocco}>
      <View style={s.bloccoHeader}><Text style={s.manoNum}>MANO {idx + 1}</Text></View>
      <View style={s.rigaHeader}>
        <View style={s.etSpazio} />
        <View style={s.col}><View style={[s.tag, { backgroundColor: '#2c5f2e' }]}><Text style={s.tagT}>A</Text></View></View>
        <View style={s.col}><View style={[s.tag, { backgroundColor: '#7a2230' }]}><Text style={s.tagT}>B</Text></View></View>
      </View>
      {righe.map(({ k, label }) => (
        <View key={k} style={[s.riga, k === 'totale' && s.rigaTotale]}>
          <Text style={s.rigaLabel}>{label}</Text>
          <View style={s.col}>
            <Campo value={datiA[k]} onChange={v => onChangeA(idx, k, v)}
              errore={k === 'totale' && erroriA.includes(idx)}
              warn={k !== 'totale' && warnA.some(w => w.smazzata === idx + 1 && w.tipo === label)} />
          </View>
          <View style={s.col}>
            <Campo value={datiB[k]} onChange={v => onChangeB(idx, k, v)}
              errore={k === 'totale' && erroriB.includes(idx)}
              warn={k !== 'totale' && warnB.some(w => w.smazzata === idx + 1 && w.tipo === label)} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Blocco riepilogo ──────────────────────────────────────────────────────────
function BloccoRiepilogo({ datiA, datiB, vpA, vpB, onChangeVpA, onChangeVpB, erroriRiepilogo, tabella }) {
  const totA = Number(datiA[3]?.totale) || 0;
  const totB = Number(datiB[3]?.totale) || 0;
  const diff = totA - totB;
  const vpCalcolati = tabella ? calcolaVPdaTabella(tabella, diff) : null;
  const vincenteA = diff >= 0;
  return (
    <View style={s.blocco}>
      <View style={s.bloccoHeader}>
        <Text style={s.manoNum}>RIEPILOGO · {tabella?.nome ?? '—'}</Text>
      </View>
      <View style={s.rigaHeader}>
        <View style={s.etSpazio} />
        <View style={s.col}><View style={[s.tag, { backgroundColor: '#2c5f2e' }]}><Text style={s.tagT}>A</Text></View></View>
        <View style={s.col}><View style={[s.tag, { backgroundColor: '#7a2230' }]}><Text style={s.tagT}>B</Text></View></View>
      </View>
      <View style={[s.riga, s.rigaTotale]}>
        <Text style={s.rigaLabel}>TOTALE</Text>
        <View style={s.col}><Text style={s.totaleCalc}>{totA}</Text></View>
        <View style={s.col}><Text style={s.totaleCalc}>{totB}</Text></View>
      </View>
      <View style={s.riga}>
        <Text style={s.rigaLabel}>DIFF.</Text>
        <View style={s.col}>{vincenteA ? <Text style={[s.diffCalc, { color: '#2c5f2e' }]}>{Math.abs(diff)}</Text> : <Text style={s.diffVuoto}>—</Text>}</View>
        <View style={s.col}>{!vincenteA ? <Text style={[s.diffCalc, { color: '#7a2230' }]}>{Math.abs(diff)}</Text> : <Text style={s.diffVuoto}>—</Text>}</View>
      </View>
      <View style={[s.riga, s.rigaTotale]}>
        <Text style={s.rigaLabel}>V.P. scritti</Text>
        <View style={s.col}><Campo value={vpA} onChange={onChangeVpA} errore={erroriRiepilogo.vpA} /></View>
        <View style={s.col}><Campo value={vpB} onChange={onChangeVpB} errore={erroriRiepilogo.vpB} /></View>
      </View>
      {vpCalcolati && (
        <View style={[s.riga, { backgroundColor: '#f0f8f0' }]}>
          <Text style={s.rigaLabel}>V.P. calc.</Text>
          <View style={s.col}><Text style={[s.vpCalc, { color: '#2c5f2e' }]}>{vpCalcolati.vpA}</Text></View>
          <View style={s.col}><Text style={[s.vpCalc, { color: '#7a2230' }]}>{vpCalcolati.vpB}</Text></View>
        </View>
      )}
    </View>
  );
}

// ── Editor Tabella ────────────────────────────────────────────────────────────
function EditorTabella({ tabella, onSalva, onAnnulla }) {
  const [nome, setNome] = useState(tabella?.nome ?? '');
  const [righe, setRighe] = useState(
    tabella?.righe.map(r => ({
      min: String(r.min), max: r.max === 99999 ? '' : String(r.max),
      vpV: String(r.vpV), vpP: String(r.vpP),
    })) ?? [{ min: '0', max: '100', vpV: '10', vpP: '10' }]
  );
  const aggiornaRiga = (i, campo, val) => setRighe(prev => { const c = [...prev]; c[i] = { ...c[i], [campo]: val }; return c; });
  const aggiungiRiga = () => setRighe(prev => [...prev, { min: '', max: '', vpV: '', vpP: '' }]);
  const rimuoviRiga = (i) => setRighe(prev => prev.filter((_, idx) => idx !== i));
  const salva = () => {
    if (!nome.trim()) { Alert.alert('Errore', 'Inserisci un nome per la tabella.'); return; }
    onSalva({
      id: tabella?.id ?? String(Date.now()), nome: nome.trim(),
      righe: righe.map(r => ({ min: parseInt(r.min) || 0, max: r.max === '' ? 99999 : parseInt(r.max) || 0, vpV: parseInt(r.vpV) || 0, vpP: parseInt(r.vpP) || 0 })),
    });
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5efe6' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}><Text style={s.titolo}>BURRACO</Text><Text style={s.sottotitolo}>Editor Tabella VP</Text></View>
        <View style={s.card}>
          <Text style={s.inputLabel}>Nome tabella</Text>
          <TextInput style={s.inputNome} value={nome} onChangeText={setNome} placeholder="Es. Torneo Roma 2026" placeholderTextColor="#9a8a75" />
        </View>
        <View style={s.card}>
          <Text style={s.cardTitolo}>Fasce punteggio</Text>
          <View style={{ flexDirection: 'row', marginBottom: 8 }}>
            <Text style={[s.colTh, { flex: 1.2 }]}>Da</Text>
            <Text style={[s.colTh, { flex: 1.2 }]}>A</Text>
            <Text style={[s.colTh, { flex: 1 }]}>VP Vin.</Text>
            <Text style={[s.colTh, { flex: 1 }]}>VP Per.</Text>
            <View style={{ width: 30 }} />
          </View>
          {righe.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 4 }}>
              <TextInput style={[s.inputTh, { flex: 1.2 }]} value={r.min} onChangeText={v => aggiornaRiga(i, 'min', v)} keyboardType="number-pad" placeholder="0" placeholderTextColor="#bbb" />
              <TextInput style={[s.inputTh, { flex: 1.2 }]} value={r.max} onChangeText={v => aggiornaRiga(i, 'max', v)} keyboardType="number-pad" placeholder="∞" placeholderTextColor="#bbb" />
              <TextInput style={[s.inputTh, { flex: 1 }]} value={r.vpV} onChangeText={v => aggiornaRiga(i, 'vpV', v)} keyboardType="number-pad" placeholder="0" placeholderTextColor="#bbb" />
              <TextInput style={[s.inputTh, { flex: 1 }]} value={r.vpP} onChangeText={v => aggiornaRiga(i, 'vpP', v)} keyboardType="number-pad" placeholder="0" placeholderTextColor="#bbb" />
              <TouchableOpacity onPress={() => rimuoviRiga(i)} style={s.btnRimuovi}><Text style={{ color: '#e74c3c', fontWeight: 'bold' }}>✕</Text></TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={s.btnAggiungiRiga} onPress={aggiungiRiga}>
            <Text style={{ color: '#d4af37', fontWeight: 'bold' }}>+ Aggiungi fascia</Text>
          </TouchableOpacity>
        </View>
        <View style={s.pulsanti}>
          <TouchableOpacity style={s.btnReset} onPress={onAnnulla}><Text style={s.btnResetT}>Annulla</Text></TouchableOpacity>
          <TouchableOpacity style={s.btnVerifica} onPress={salva}><Text style={s.btnVerificaT}>Salva tabella</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Impostazioni ──────────────────────────────────────────────────────────────
function SchermatImpostazioni({ onTorna }) {
  const [apiKey, setApiKey] = useState('');
  const [salvata, setSalvata] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [tabelle, setTabelle] = useState(TABELLE_DEFAULT);
  const [tabellaAttivaId, setTabellaAttivaId] = useState('default');
  const [editorTabella, setEditorTabella] = useState(null);

  useEffect(() => {
    (async () => {
      const k = await SecureStore.getItemAsync(CHIAVE_STORAGE);
      if (k) { setApiKey(k); setSalvata(true); }
      const t = await SecureStore.getItemAsync(TABELLE_STORAGE);
      if (t) { try { setTabelle(JSON.parse(t)); } catch (_) {} } else { setTabelle(TABELLE_DEFAULT); }
      const ta = await SecureStore.getItemAsync(TABELLA_ATTIVA_STORAGE);
      if (ta) setTabellaAttivaId(ta);
      setCaricamento(false);
    })();
  }, []);

  const salvaApiKey = async () => {
    const pulita = apiKey.trim();
    if (!pulita.startsWith('sk-ant-')) { Alert.alert('Chiave non valida', 'La API key deve iniziare con "sk-ant-".'); return; }
    await SecureStore.setItemAsync(CHIAVE_STORAGE, pulita); setSalvata(true); Alert.alert('Salvata', 'API key salvata.');
  };
  const eliminaApiKey = async () => Alert.alert('Elimina chiave', 'Sei sicuro?', [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Elimina', style: 'destructive', onPress: async () => { await SecureStore.deleteItemAsync(CHIAVE_STORAGE); setApiKey(''); setSalvata(false); } },
  ]);
  const salvaTabelle = async (nuove) => { setTabelle(nuove); await SecureStore.setItemAsync(TABELLE_STORAGE, JSON.stringify(nuove)); };
  const salvaTabellaAttiva = async (id) => { setTabellaAttivaId(id); await SecureStore.setItemAsync(TABELLA_ATTIVA_STORAGE, id); };
  const onSalvaTabella = async (tab) => {
    const nuove = tabelle.find(t => t.id === tab.id) ? tabelle.map(t => t.id === tab.id ? tab : t) : [...tabelle, tab];
    await salvaTabelle(nuove); setEditorTabella(null);
  };
  const eliminaTabella = (id) => {
    if (id === 'default' || id === 'a_squadre') { Alert.alert('Errore', 'Le tabelle predefinite non possono essere eliminate.'); return; }
    Alert.alert('Elimina tabella', 'Sei sicuro?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: async () => { const nuove = tabelle.filter(t => t.id !== id); await salvaTabelle(nuove); if (tabellaAttivaId === id) await salvaTabellaAttiva('default'); } },
    ]);
  };

  if (caricamento) return <View style={s.centrato}><ActivityIndicator color="#d4af37" size="large" /></View>;
  if (editorTabella !== null) return <EditorTabella tabella={editorTabella === 'nuova' ? null : editorTabella} onSalva={onSalvaTabella} onAnnulla={() => setEditorTabella(null)} />;

  const tabellaAttiva = tabelle.find(t => t.id === tabellaAttivaId) ?? TABELLA_DEFAULT;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5efe6' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}><Text style={s.titolo}>BURRACO</Text><Text style={s.sottotitolo}>Impostazioni</Text></View>
        <View style={s.card}>
          <Text style={s.cardTitolo}>API Key Anthropic</Text>
          <Text style={s.testo}>Necessaria per l'analisi OCR delle foto. Costo {'<'} 1 centesimo per analisi. Ottieni la chiave su console.anthropic.com</Text>
          <Text style={s.inputLabel}>La tua API Key</Text>
          <TextInput style={s.inputNome} value={apiKey} onChangeText={v => { setApiKey(v); setSalvata(false); }}
            placeholder="sk-ant-..." placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
          {salvata && <Text style={s.salvataMsg}>✓ Chiave salvata e attiva</Text>}
          <View style={[s.pulsanti, { paddingHorizontal: 0, paddingTop: 10 }]}>
            <TouchableOpacity style={s.btnVerifica} onPress={salvaApiKey}><Text style={s.btnVerificaT}>Salva chiave</Text></TouchableOpacity>
            {salvata && <TouchableOpacity style={[s.btnReset, { borderColor: '#e74c3c' }]} onPress={eliminaApiKey}><Text style={[s.btnResetT, { color: '#e74c3c' }]}>Elimina</Text></TouchableOpacity>}
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitolo}>Tabelle Victory Points</Text>
          <Text style={s.testo}>Seleziona la tabella da usare. Puoi modificarla o aggiungerne di nuove.</Text>
          {tabelle.map(t => (
            <View key={t.id} style={s.rigaTabella}>
              <TouchableOpacity style={s.radioBtnWrap} onPress={() => salvaTabellaAttiva(t.id)}>
                <View style={[s.radioBtn, tabellaAttivaId === t.id && s.radioBtnAttivo]} />
                <Text style={[s.nomeTabellaT, tabellaAttivaId === t.id && { color: '#1a1a2e', fontWeight: 'bold' }]}>{t.nome}</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity onPress={() => setEditorTabella(t)} style={s.btnTabAzione}><Text style={{ color: '#7a6a55', fontSize: 12 }}>✏ Modifica</Text></TouchableOpacity>
                {t.id !== 'default' && t.id !== 'a_squadre' && <TouchableOpacity onPress={() => eliminaTabella(t.id)} style={s.btnTabAzione}><Text style={{ color: '#e74c3c', fontSize: 12 }}>✕</Text></TouchableOpacity>}
              </View>
            </View>
          ))}
          <View style={{ marginTop: 14 }}>
            <Text style={[s.inputLabel, { marginBottom: 8 }]}>Fasce: {tabellaAttiva.nome}</Text>
            <View style={{ flexDirection: 'row', marginBottom: 4, paddingHorizontal: 4 }}>
              <Text style={[s.colTh, { flex: 2 }]}>Differenza</Text>
              <Text style={[s.colTh, { flex: 1 }]}>VP Vin.</Text>
              <Text style={[s.colTh, { flex: 1 }]}>VP Per.</Text>
            </View>
            {tabellaAttiva.righe.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f0e8d8', backgroundColor: i % 2 === 0 ? '#fff' : '#fdfaf5' }}>
                <Text style={[s.cellTh, { flex: 2 }]}>{r.min} – {r.max === 99999 ? '2005+' : r.max}</Text>
                <Text style={[s.cellTh, { flex: 1, color: '#2c5f2e', fontWeight: 'bold' }]}>{r.vpV}</Text>
                <Text style={[s.cellTh, { flex: 1, color: '#7a2230', fontWeight: 'bold' }]}>{r.vpP}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={[s.btnVerifica, { marginTop: 14 }]} onPress={() => setEditorTabella('nuova')}>
            <Text style={s.btnVerificaT}>+ Nuova tabella</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={{ padding: 16, alignItems: 'center' }} onPress={onTorna}>
          <Text style={{ color: '#7a6a55', fontSize: 14 }}>← Torna all'app</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
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

function testoErrori(n) { return n === 1 ? '1 errore trovato' : `${n} errori trovati`; }

const SYSTEM_PROMPT = `Sei un esperto letturista di segnapunti di Burraco scritti a mano.

STRUTTURA DEL FOGLIO:
- Due colonne: Coppia A (sinistra) e Coppia B (destra)
- 4 smazzate/mani, ciascuna con tre righe: BASE, PUNTI, TOTALE
- In fondo: VICTORY POINT per A e per B

VINCOLI MATEMATICI DA SFRUTTARE:
- BASE: sempre multiplo di 50 (0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500...)
- PUNTI: sempre multiplo di 5 (0, 5, 10, 15, 20, 25, 30...)
- TOTALE mano 1 = BASE1 + PUNTI1
- TOTALE mano 2 = TOTALE1 + BASE2 + PUNTI2
- TOTALE mano 3 = TOTALE2 + BASE3 + PUNTI3
- TOTALE mano 4 = TOTALE3 + BASE4 + PUNTI4
- Usa questi vincoli per CORREGGERE eventuali errori di lettura

REGOLE DI LETTURA:
- Trattino (-), slash (/), segno singolo isolato = 0
- Segno meno PRIMA o DOPO il numero = valore negativo (es: "150-" = -150)
- Se un numero non rispetta il vincolo multiplo, arrotonda al multiplo piu' vicino
- Cifra "1" e lettera "I" sono spesso confuse: usa il contesto per distinguerle
- Cifra "0" e lettera "O" sono spesso confuse: usa il contesto
- Cifra "7" con tratto orizzontale puo' sembrare "1": usa il contesto

PROCEDURA:
1. Leggi la colonna A dall'alto verso il basso: BASE1, PUNTI1, TOTALE1, BASE2, PUNTI2, TOTALE2, ecc.
2. Verifica che i TOTALI siano matematicamente coerenti con BASE e PUNTI
3. Se c'e' incoerenza, determina quale valore e' piu' plausibile e correggilo
4. Ripeti per la colonna B
5. Leggi i VP in fondo

Restituisci SOLO JSON valido senza markdown, senza testo aggiuntivo:
{"nomiA":["nome1","nome2"],"nomiB":["nome1","nome2"],"smazzate":[{"a":{"base":0,"punti":0,"totale":0},"b":{"base":0,"punti":0,"totale":0}},{"a":{"base":0,"punti":0,"totale":0},"b":{"base":0,"punti":0,"totale":0}},{"a":{"base":0,"punti":0,"totale":0},"b":{"base":0,"punti":0,"totale":0}},{"a":{"base":0,"punti":0,"totale":0},"b":{"base":0,"punti":0,"totale":0}}],"vpA":0,"vpB":0}`;

async function estraiDatiDaFoto(uri, apiKey) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const risposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 1200, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: 'Leggi questo segnapunti di Burraco. Applica tutti i vincoli matematici per verificare e correggere i valori. Restituisci solo il JSON.' },
      ]}],
    }),
  });
  if (!risposta.ok) { const err = await risposta.json().catch(() => ({})); throw new Error(err?.error?.message ?? `Errore API: ${risposta.status}`); }
  const dati = await risposta.json();
  const testo = dati.content.find(b => b.type === 'text')?.text ?? '';
  return JSON.parse(testo.replace(/```json|```/g, '').trim());
}

// ── Visualizzatore foto fullscreen con zoom ───────────────────────────────────
function FotoViewer({ uri, onClose }) {
  const { width, height } = Dimensions.get('window');
  return (
    <Modal visible={!!uri} transparent={false} animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {/* Pulsante chiudi */}
        <TouchableOpacity onPress={onClose} style={fvs.btnChiudi}>
          <Text style={fvs.btnChiudiT}>✕</Text>
        </TouchableOpacity>
        <Text style={fvs.hint}>Pizzica per zoomare · Scorri per esplorare</Text>
        {/* ScrollView con zoom nativo */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          <Image
            source={{ uri }}
            style={{ width, height: height - 100 }}
            resizeMode="contain"
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const fvs = StyleSheet.create({
  btnChiudi: {
    position: 'absolute', top: 48, right: 16, zIndex: 10,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  btnChiudiT: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  hint: {
    color: 'rgba(255,255,255,0.4)', fontSize: 11,
    textAlign: 'center', marginTop: 52, marginBottom: 4,
  },
});

// ── Home ──────────────────────────────────────────────────────────────────────
function SchermatHome({ onImpostazioni }) {
  const vuoto = () => Array.from({ length: SMAZZATE }, () => ({ base: '', punti: '', totale: '' }));
  const [nomiA, setNomiA] = useState(['', '']);
  const [nomiB, setNomiB] = useState(['', '']);
  const [datiA, setDatiA] = useState(vuoto());
  const [datiB, setDatiB] = useState(vuoto());
  const [vpA, setVpA] = useState('');
  const [vpB, setVpB] = useState('');
  const [risultato, setRisultato] = useState(null);
  const [anteprima, setAnteprima] = useState(null);
  const [fotoAperta, setFotoAperta] = useState(false);
  const [stato, setStato] = useState('idle');
  const [erroreMsg, setErroreMsg] = useState('');
  const [apiKey, setApiKey] = useState(null);
  const [tabella, setTabella] = useState(TABELLA_DEFAULT);

  useEffect(() => {
    const carica = async () => {
      const k = await SecureStore.getItemAsync(CHIAVE_STORAGE);
      setApiKey(k ?? null);
      const t = await SecureStore.getItemAsync(TABELLE_STORAGE);
      const tabelle = t ? JSON.parse(t) : TABELLE_DEFAULT;
      const ta = await SecureStore.getItemAsync(TABELLA_ATTIVA_STORAGE) ?? 'default';
      setTabella(tabelle.find(x => x.id === ta) ?? TABELLA_DEFAULT);
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
    wA.forEach(w => errori.push({ desc: `Mano ${w.smazzata} Coppia A: ${w.tipo} "${w.valore}" non è multiplo valido` }));
    wB.forEach(w => errori.push({ desc: `Mano ${w.smazzata} Coppia B: ${w.tipo} "${w.valore}" non è multiplo valido` }));
    const totA = Number(a[3]?.totale) || 0; const totB = Number(b[3]?.totale) || 0;
    const vpCalcolati = tab ? calcolaVPdaTabella(tab, totA - totB) : null;
    const erroriRiepilogo = { vpA: false, vpB: false };
    if (vpCalcolati && vA !== '' && Number(vA) !== vpCalcolati.vpA) { errori.push({ desc: `VP Coppia A: scritto ${vA}, atteso ${vpCalcolati.vpA}` }); erroriRiepilogo.vpA = true; }
    if (vpCalcolati && vB !== '' && Number(vB) !== vpCalcolati.vpB) { errori.push({ desc: `VP Coppia B: scritto ${vB}, atteso ${vpCalcolati.vpB}` }); erroriRiepilogo.vpB = true; }
    return { ok: errori.length === 0, errori, indiciErrA, indiciErrB, erroriRiepilogo, warnA: wA, warnB: wB };
  }, []);

  useEffect(() => {
    const hasDati = datiA.some(r => r.base !== '' || r.punti !== '' || r.totale !== '') ||
                    datiB.some(r => r.base !== '' || r.punti !== '' || r.totale !== '');
    if (hasDati) setRisultato(calcolaRisultato(datiA, datiB, vpA, vpB, tabella));
    else setRisultato(null);
  }, [datiA, datiB, vpA, vpB, tabella]);

  const aggiorna = useCallback((setter, idx, campo, valore) => {
    setter(prev => { const c = prev.map(r => ({ ...r })); c[idx][campo] = valore; return c; });
  }, []);

  const controllaApiKey = () => {
    if (!apiKey) { Alert.alert('API Key mancante', 'Configurala nelle impostazioni.', [{ text: 'Impostazioni', onPress: onImpostazioni }, { text: 'Annulla' }]); return false; }
    return true;
  };

  const salvaInAlbumBurraco = async (uri) => {
    try {
      // Chiede permesso di scrittura in galleria
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') return;

      // Salva l'asset nella libreria
      const asset = await MediaLibrary.createAssetAsync(uri);

      // Cerca o crea l'album "Burraco"
      let album = await MediaLibrary.getAlbumAsync('Burraco');
      if (album === null) {
        await MediaLibrary.createAlbumAsync('Burraco', asset, false);
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      }
    } catch (_) {
      // Salvataggio in galleria fallito silenziosamente — non blocca il flusso
    }
  };

  const scattaFoto = async () => {
    if (!controllaApiKey()) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permesso negato', "Consenti l'accesso alla fotocamera."); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1.0, base64: false });
    if (!res.canceled && res.assets?.[0]?.uri) {
      const uri = res.assets[0].uri;
      // Salva in galleria nell'album Burraco (in background, non blocca)
      salvaInAlbumBurraco(uri);
      elaboraFoto(uri);
    }
  };

  const caricaDaLibreria = async () => {
    if (!controllaApiKey()) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permesso negato', "Consenti l'accesso alla galleria."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1.0, base64: false });
    if (!res.canceled && res.assets?.[0]?.uri) elaboraFoto(res.assets[0].uri);
  };

  const elaboraFoto = async (uri) => {
    setAnteprima(uri); setStato('analisi'); setRisultato(null); setErroreMsg('');
    try {
      const dati = await estraiDatiDaFoto(uri, apiKey);
      const toStr = v => String(parseValore(v));
      const nuoviA = dati.smazzate.map(sm => ({ base: toStr(sm.a.base), punti: toStr(sm.a.punti), totale: toStr(sm.a.totale) }));
      const nuoviB = dati.smazzate.map(sm => ({ base: toStr(sm.b.base), punti: toStr(sm.b.punti), totale: toStr(sm.b.totale) }));
      const nVpA = toStr(dati.vpA); const nVpB = toStr(dati.vpB);
      setNomiA(dati.nomiA?.length ? dati.nomiA : ['', '']);
      setNomiB(dati.nomiB?.length ? dati.nomiB : ['', '']);
      setDatiA(nuoviA); setDatiB(nuoviB); setVpA(nVpA); setVpB(nVpB);
      setStato('fatto');
    } catch (e) { setStato('errore'); setErroreMsg(e.message); }
  };

  const reset = () => { setDatiA(vuoto()); setDatiB(vuoto()); setNomiA(['', '']); setNomiB(['', '']); setVpA(''); setVpB(''); setRisultato(null); setAnteprima(null); setFotoAperta(false); setStato('idle'); setErroreMsg(''); };
  const ris = risultato;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5efe6' }}>
      <StatusBar style="light" />
      <FotoViewer uri={fotoAperta ? anteprima : null} onClose={() => setFotoAperta(false)} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Text style={s.titolo}>BURRACO</Text>
          <Text style={s.sottotitolo}>Verifica Punteggi</Text>
          <TouchableOpacity style={s.btnImp} onPress={onImpostazioni}><Text style={s.btnImpT}>⚙ Impostazioni</Text></TouchableOpacity>
        </View>
        <View style={s.bannerTabella}>
          <Text style={s.bannerTabellaT}>📊 Tabella VP attiva: <Text style={{ fontWeight: 'bold' }}>{tabella.nome}</Text></Text>
        </View>
        <View style={{ padding: 14 }}>
          {stato === 'analisi' ? (
            <View style={s.loading}><ActivityIndicator color="#d4af37" size="large" /><Text style={s.loadingT}>Analisi in corso…</Text></View>
          ) : anteprima ? (
            <View style={{ gap: 8 }}>
              <TouchableOpacity onPress={() => setFotoAperta(true)} activeOpacity={0.85}>
                <Image source={{ uri: anteprima }} style={s.anteprima} resizeMode="cover" />
                <View style={s.zoomHint}><Text style={s.zoomHintT}>🔍 Tocca per ingrandire</Text></View>
              </TouchableOpacity>
              <View style={s.btnRiga}>
                <TouchableOpacity style={s.btnSec} onPress={scattaFoto}><Text style={s.btnSecT}>📷 Nuova foto</Text></TouchableOpacity>
                <TouchableOpacity style={s.btnSec} onPress={caricaDaLibreria}><Text style={s.btnSecT}>🖼 Libreria</Text></TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.btnRiga}>
              <TouchableOpacity style={s.btnScan} onPress={scattaFoto}><Text style={s.btnScanIcona}>📷</Text><Text style={s.btnScanT}>Fotocamera</Text></TouchableOpacity>
              <TouchableOpacity style={s.btnScan} onPress={caricaDaLibreria}><Text style={s.btnScanIcona}>🖼</Text><Text style={s.btnScanT}>Libreria</Text></TouchableOpacity>
            </View>
          )}
          {stato === 'errore' && <View style={s.erroreApi}><Text style={s.erroreApiT}>⚠ {erroreMsg}</Text></View>}
        </View>
        <View style={s.nomiSection}>
          {[{ label: 'COPPIA A', nomi: nomiA, setNomi: setNomiA, colore: '#2c5f2e' }, { label: 'COPPIA B', nomi: nomiB, setNomi: setNomiB, colore: '#7a2230' }].map(({ label, nomi, setNomi, colore }) => (
            <View key={label} style={s.nomiCol}>
              <Text style={[s.nomiHead, { color: colore }]}>{label}</Text>
              {[0, 1].map(i => <TextInput key={i} style={s.inputNome} value={nomi[i]} onChangeText={v => { const n = [...nomi]; n[i] = v; setNomi(n); }} placeholder={`Giocatore ${i + 1}`} placeholderTextColor="#b0a080" />)}
            </View>
          ))}
        </View>
        <View style={s.griglia}>
          {Array.from({ length: SMAZZATE }, (_, i) => (
            <BloccoMano key={i} idx={i} datiA={datiA[i]} datiB={datiB[i]}
              onChangeA={(idx, k, v) => aggiorna(setDatiA, idx, k, v)}
              onChangeB={(idx, k, v) => aggiorna(setDatiB, idx, k, v)}
              erroriA={ris?.indiciErrA ?? []} erroriB={ris?.indiciErrB ?? []}
              warnA={ris?.warnA ?? []} warnB={ris?.warnB ?? []} />
          ))}
          <BloccoRiepilogo datiA={datiA} datiB={datiB} vpA={vpA} vpB={vpB}
            onChangeVpA={v => setVpA(v)} onChangeVpB={v => setVpB(v)}
            erroriRiepilogo={ris?.erroriRiepilogo ?? {}} tabella={tabella} />
        </View>
        <View style={s.pulsanti}>
          <TouchableOpacity style={[s.btnReset, { flex: 1 }]} onPress={reset}><Text style={s.btnResetT}>↺ Reset</Text></TouchableOpacity>
        </View>
        {ris && (
          <View style={[s.risultatoBox, ris.ok ? s.boxOk : s.boxErr]}>
            {ris.ok ? (
              <View style={s.rigaOk}><Text style={s.iconaOk}>✓</Text><View><Text style={s.testoOk}>Tutto corretto!</Text><Text style={s.subOk}>Somme, differenza e Victory Point verificati.</Text></View></View>
            ) : (
              <View>
                <View style={s.rigaErrHeader}><Text style={s.iconaErr}>✗</Text><Text style={s.testoErr}>{testoErrori(ris.errori.length)}</Text></View>
                {ris.errori.map((e, i) => (
                  <View key={i} style={s.rigaErrore}>
                    {e.colonna ? <View style={[s.tag, { backgroundColor: e.colonna === 'A' ? '#2c5f2e' : '#7a2230', width: 20, height: 20 }]}><Text style={[s.tagT, { fontSize: 11 }]}>{e.colonna}</Text></View>
                      : <View style={[s.tag, { backgroundColor: '#b8860b', width: 20, height: 20 }]}><Text style={[s.tagT, { fontSize: 9 }]}>!</Text></View>}
                    <View style={{ flex: 1 }}>
                      {e.desc ? <Text style={s.errDet}>{e.desc}</Text>
                        : <><Text style={s.errDet}>Mano {e.smazzata} — scritto <Text style={{ fontWeight: 'bold' }}>{e.scritto}</Text>, atteso <Text style={{ fontWeight: 'bold' }}>{e.atteso}</Text></Text>
                           <Text style={s.errDiff}>Differenza: {e.atteso - e.scritto > 0 ? '+' : ''}{e.atteso - e.scritto} punti</Text></>}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [schermata, setSchermata] = useState('home');
  if (schermata === 'impostazioni') return <SchermatImpostazioni onTorna={() => setSchermata('home')} />;
  return <SchermatHome onImpostazioni={() => setSchermata('impostazioni')} />;
}

const s = StyleSheet.create({
  centrato: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5efe6' },
  header: { backgroundColor: '#1a1a2e', paddingTop: 20, paddingBottom: 14, alignItems: 'center' },
  titolo: { fontSize: 30, letterSpacing: 8, color: '#d4af37', fontWeight: 'bold' },
  sottotitolo: { fontSize: 11, color: '#a0a0c0', letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 },
  btnImp: { marginTop: 10, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#d4af3766', borderRadius: 20 },
  btnImpT: { color: '#d4af37', fontSize: 12 },
  bannerTabella: { backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#d4af3744', padding: 8, paddingHorizontal: 16 },
  bannerTabellaT: { color: '#a0a0c0', fontSize: 11 },
  btnRiga: { flexDirection: 'row', gap: 10 },
  btnScan: { flex: 1, backgroundColor: '#1a1a2e', borderWidth: 2, borderColor: '#d4af37', borderStyle: 'dashed', borderRadius: 12, padding: 18, alignItems: 'center', gap: 4 },
  btnScanIcona: { fontSize: 28 },
  btnScanT: { color: '#d4af37', fontSize: 14, fontWeight: 'bold' },
  anteprima: { width: '100%', height: 180, borderRadius: 10, borderWidth: 2, borderColor: '#d4af37' },
  zoomHint: { position: 'absolute', bottom: 6, right: 8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  zoomHintT: { color: '#fff', fontSize: 10 },
  btnSec: { flex: 1, borderWidth: 1, borderColor: '#c8b89a', borderRadius: 8, padding: 8, alignItems: 'center' },
  btnSecT: { color: '#7a6a55', fontSize: 13 },
  loading: { alignItems: 'center', padding: 24, gap: 10 },
  loadingT: { color: '#7a6a55', fontSize: 14, fontStyle: 'italic' },
  erroreApi: { marginTop: 8, padding: 12, backgroundColor: '#fdf0f0', borderWidth: 1, borderColor: '#e74c3c', borderRadius: 8 },
  erroreApiT: { color: '#c0392b', fontSize: 13 },
  nomiSection: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingBottom: 6 },
  nomiCol: { flex: 1, gap: 5 },
  nomiHead: { fontSize: 10, letterSpacing: 1.5, fontWeight: 'bold', textTransform: 'uppercase' },
  inputNome: { borderWidth: 1, borderColor: '#c8b89a', borderRadius: 6, padding: 7, fontSize: 13, backgroundColor: '#fffdf8', color: '#3a2e22' },
  griglia: { paddingHorizontal: 12, gap: 8 },
  blocco: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#ddd0b8', overflow: 'hidden', elevation: 2 },
  bloccoHeader: { backgroundColor: '#1a1a2e', padding: 7, paddingHorizontal: 12 },
  manoNum: { color: '#d4af37', fontSize: 11, fontWeight: 'bold', letterSpacing: 2, textTransform: 'uppercase' },
  rigaHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fdfaf5', borderBottomWidth: 1, borderBottomColor: '#f0e8d8' },
  etSpazio: { width: 54 },
  col: { flex: 1, alignItems: 'center' },
  tag: { width: 24, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  tagT: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  riga: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f0e8d8', backgroundColor: '#fff' },
  rigaTotale: { backgroundColor: '#faf6f0', borderTopWidth: 2, borderTopColor: '#e8dcc8' },
  rigaLabel: { width: 54, fontSize: 9, letterSpacing: 1, color: '#9a8a75', fontWeight: 'bold', textTransform: 'uppercase' },
  campoWrap: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center', gap: 3 },
  btnSegno: { width: 24, height: 34, borderRadius: 5, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },
  btnSegnoT: { color: '#d4af37', fontSize: 16, fontWeight: 'bold', lineHeight: 20 },
  input: { borderWidth: 1.5, borderColor: '#c8b89a', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 2, fontSize: 15, textAlign: 'center', color: '#2a1e12', backgroundColor: '#fffdf8', flex: 1 },
  inputErr: { borderColor: '#e74c3c', backgroundColor: '#fff0ee' },
  inputWarn: { borderColor: '#e67e22', backgroundColor: '#fff8ee' },
  totaleCalc: { fontSize: 18, fontWeight: 'bold', color: '#2a1e12', textAlign: 'center' },
  diffCalc: { fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  diffVuoto: { fontSize: 16, color: '#ccc', textAlign: 'center' },
  vpCalc: { fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  pulsanti: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
  btnVerifica: { flex: 2, backgroundColor: '#1a1a2e', borderRadius: 10, padding: 14, alignItems: 'center', elevation: 4 },
  btnVerificaT: { color: '#d4af37', fontSize: 15, fontWeight: 'bold', letterSpacing: 1 },
  btnReset: { flex: 1, borderWidth: 1.5, borderColor: '#c8b89a', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnResetT: { color: '#7a6a55', fontSize: 14 },
  risultatoBox: { marginHorizontal: 12, marginTop: 4, borderRadius: 10, borderWidth: 1.5, padding: 14 },
  boxOk: { backgroundColor: '#eafaf1', borderColor: '#2ecc71' },
  boxErr: { backgroundColor: '#fdf0f0', borderColor: '#e74c3c' },
  rigaOk: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconaOk: { fontSize: 28, color: '#2ecc71', fontWeight: 'bold' },
  testoOk: { fontSize: 14, color: '#1a6b3a', fontWeight: 'bold' },
  subOk: { fontSize: 11, color: '#4a9a6a', marginTop: 2 },
  rigaErrHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  iconaErr: { fontSize: 24, color: '#e74c3c', fontWeight: 'bold' },
  testoErr: { fontSize: 14, color: '#c0392b', fontWeight: 'bold' },
  rigaErrore: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  errDet: { fontSize: 13, color: '#5a2020', flex: 1, flexWrap: 'wrap' },
  errDiff: { fontSize: 11, color: '#c0392b', marginTop: 2 },
  card: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#ddd0b8' },
  cardTitolo: { fontSize: 13, fontWeight: 'bold', color: '#3a2e22', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  testo: { fontSize: 14, color: '#5a4a3a', lineHeight: 21, marginBottom: 10 },
  inputLabel: { fontSize: 11, letterSpacing: 1.5, color: '#7a6a55', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: 8 },
  salvataMsg: { marginTop: 8, fontSize: 13, color: '#2c5f2e', fontWeight: 'bold' },
  rigaTabella: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0e8d8' },
  radioBtnWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  radioBtn: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#c8b89a', backgroundColor: '#fff' },
  radioBtnAttivo: { borderColor: '#1a1a2e', backgroundColor: '#1a1a2e' },
  nomeTabellaT: { fontSize: 14, color: '#7a6a55' },
  btnTabAzione: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#e8dcc8', borderRadius: 6 },
  colTh: { fontSize: 10, fontWeight: 'bold', color: '#9a8a75', textTransform: 'uppercase', textAlign: 'center' },
  cellTh: { fontSize: 13, color: '#3a2e22', textAlign: 'center' },
  inputTh: { borderWidth: 1, borderColor: '#c8b89a', borderRadius: 5, padding: 6, fontSize: 13, textAlign: 'center', color: '#2a1e12', backgroundColor: '#fffdf8' },
  btnRimuovi: { width: 30, alignItems: 'center', justifyContent: 'center' },
  btnAggiungiRiga: { marginTop: 10, padding: 10, borderWidth: 1, borderColor: '#d4af37', borderRadius: 8, alignItems: 'center', borderStyle: 'dashed' },
});
