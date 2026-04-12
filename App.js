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
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { StatusBar } from 'expo-status-bar';

const { width: SW, height: SH } = Dimensions.get('window');

const CHIAVE_STORAGE = 'anthropic_api_key';
const TABELLE_STORAGE = 'tabelle_vp';
const TABELLA_ATTIVA_STORAGE = 'tabella_attiva';
const ATTENDIBILITA_STORAGE = 'attendibilita_ocr';
const PASSWORD_STORAGE = 'api_key_password';
const SMAZZATE = 4;

// Soglie confidenza per livello attendibilità
// basso: mostra sempre | medio: >= 60 | alto: >= 85
const SOGLIA_ATTENDIBILITA = { basso: 0, medio: 70, alto: 90 };
const SOGLIA_INAFFIDABILE = 40; // sotto questa soglia il campo è scartato dalla validazione

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

// ── Prompt OCR ────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Leggi un segnapunti di Burraco scritto a mano.
Struttura: due colonne A e B, 4 mani, ciascuna con BASE + PUNTI + TOTALE. In fondo VP.

REGOLA 1 — VINCOLI ASSOLUTI (hanno priorità su tutto):
BASE deve essere multiplo di 50: 0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500...
PUNTI deve essere multiplo di 5: 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55...
Se leggi un valore non ammesso, scegli il multiplo più vicino visivamente.
TOTALE: trascrivi ESATTAMENTE il numero scritto. Non calcolare mai.

REGOLA 2 — CIFRE AMBIGUE (usa il vincolo del campo per disambiguare):
5 vs 3: il 5 ha stanghetta superiore orizzontale, il 3 ha due curve aperte a destra
5 vs 8: il 5 ha parte superiore piatta, l'8 è chiuso
0 vs 6: lo 0 è ovale chiuso, il 6 ha gancio in alto
0 vs 9: lo 0 è ovale, il 9 ha asta in basso
1 vs 7: il 7 ha barra orizzontale in alto
Trattino o slash isolato = 0. Segno meno = negativo.

REGOLA 3 — CONFIDENZA:
Abbassa la confidenza quando hai dubbi sulla cifra:
95-100 = chiarissima | 75-90 = abbastanza chiara | 50-70 = ambigua | 20-45 = molto dubbia
NON fare verifiche matematiche: la validazione è compito dell'app.

Leggi anche: turno, tavolo, nomi, tessere se presenti.
Rispondi SOLO con JSON valido:
{turno:,tavolo:,nomiA:[,],tessereA:[,],nomiB:[,],tessereB:[,],smazzate:[{a:{base:0,baseC:100,punti:0,puntiC:100,totale:0,totaleC:100},b:{base:0,baseC:100,punti:0,puntiC:100,totale:0,totaleC:100}},{a:{base:0,baseC:100,punti:0,puntiC:100,totale:0,totaleC:100},b:{base:0,baseC:100,punti:0,puntiC:100,totale:0,totaleC:100}},{a:{base:0,baseC:100,punti:0,puntiC:100,totale:0,totaleC:100},b:{base:0,baseC:100,punti:0,puntiC:100,totale:0,totaleC:100}},{a:{base:0,baseC:100,punti:0,puntiC:100,totale:0,totaleC:100},b:{base:0,baseC:100,punti:0,puntiC:100,totale:0,totaleC:100}}],vpA:0,vpAC:100,vpB:0,vpBC:100}`;

// ── Preprocessing ──────────────────────────────────────────────────────────────
async function preprocessImmagine(uri) {
  try {
    const risultato = await ImageManipulator.manipulateAsync(
      uri, [{ resize: { width: 1400 } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    );
    return risultato.uri;
  } catch (_) { return uri; }
}

// ── OCR: singola chiamata senza extended thinking ─────────────────────────────
async function estraiDatiDaFoto(uri, apiKey) {
  const uriProcessato = await preprocessImmagine(uri);
  const base64 = await FileSystem.readAsStringAsync(uriProcessato, { encoding: FileSystem.EncodingType.Base64 });
  const risposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
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

// ── Campo compatto con +/- colorato e suggerimento al focus ──────────────────
// suggerito: valore atteso calcolato dall'app (pre-impostato all'ingresso in modifica)
function C({ value, onChange, errore, warn, bold, suggerito }) {
  const inputRef = useRef(null);
  const isNeg = value?.startsWith('-');
  const toggleSegno = () => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n !== 0) onChange(String(-n));
  };
  const onFocus = () => {
    if (suggerito !== undefined && suggerito !== null && !isNaN(Number(suggerito))) {
      // Imposta il suggerimento — il campo viene interamente sostituito
      onChange(String(Number(suggerito)));
    }
    // Seleziona tutto il testo dopo il render
    setTimeout(() => {
      inputRef.current?.setNativeProps({ selection: { start: 0, end: 999 } });
    }, 30);
  };
  return (
    <View style={g.cellWrap}>
      <TouchableOpacity onPress={toggleSegno} style={[g.segnoBtn, isNeg ? g.segnoBtnNeg : g.segnoBtnPos]}>
        <Text style={g.segnoT}>{isNeg ? '−' : '+'}</Text>
      </TouchableOpacity>
      <TextInput
        ref={inputRef}
        keyboardType="number-pad"
        value={value?.replace('-', '') ?? ''}
        onChangeText={v => {
          const cifre = v.replace(/[^0-9]/g, '');
          const neg = value?.startsWith('-');
          onChange(cifre === '' ? '' : (neg ? '-' + cifre : cifre));
        }}
        onFocus={onFocus}
        style={[g.cellInput, errore && g.cellErr, warn && !errore && g.cellWarn, bold && g.cellBold]}
        placeholder="—"
        placeholderTextColor="#bbb"
        selectTextOnFocus
      />
    </View>
  );
}

// ── Campo VP senza pulsante segno ────────────────────────────────────────────
function CVP({ value, onChange, errore, suggerito, coloreTesto }) {
  const onFocus = () => {
    if (suggerito !== undefined && suggerito !== null && !isNaN(Number(suggerito))) {
      onChange(String(Number(suggerito)));
    }
  };
  return (
    <TextInput
      keyboardType="number-pad"
      value={value ?? ''}
      onChangeText={v => onChange(v.replace(/[^0-9]/g, ''))}
      onFocus={onFocus}
      style={[g.cellInput, g.cellBold, { color: coloreTesto ?? '#2a1e12' }, errore && g.cellErr]}
      placeholder="—"
      placeholderTextColor="#bbb"
      selectTextOnFocus
    />
  );
}

// ── Griglia punteggi compatta ─────────────────────────────────────────────────
function Griglia({ datiA, datiB, vpA, vpB, onChangeA, onChangeB, onChangeVpA, onChangeVpB, risultato, tabella, nomiA, nomiB, tessereA, tessereB, turno, tavolo, onChangeNomiA, onChangeNomiB, onChangeTessereA, onChangeTessereB, onChangeTurno, onChangeTavolo }) {
  const ris = risultato;
  const totA = Number(datiA[3]?.totale) || 0;
  const totB = Number(datiB[3]?.totale) || 0;
  const diff = totA - totB;
  const vpCalc = tabella ? calcolaVPdaTabella(tabella, diff) : null;

  const ROW_H = 32;
  const HEADER_H = 28;

  const coloreRiga = (i) => i % 2 === 0 ? '#fff' : '#fafaf7';

  // Funzione per aggiornare un elemento di array di stato
  const updArr = (setter, idx, val) => setter(prev => { const c = [...prev]; c[idx] = val; return c; });

  const rigaTurnoTavolo = (
    <View style={[g.riga, { backgroundColor: '#2a2a3e', paddingVertical: 3 }]}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Text style={{ fontSize: 10, color: '#a0a0c0', fontWeight: 'bold' }}>Turno</Text>
        <TextInput
          value={turno}
          onChangeText={onChangeTurno}
          style={{ fontSize: 12, color: '#fff', fontWeight: 'bold', minWidth: 40, textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#555', paddingVertical: 2 }}
          placeholder="—" placeholderTextColor="#666"
          selectTextOnFocus
        />
        <Text style={{ fontSize: 10, color: '#a0a0c0', fontWeight: 'bold', marginLeft: 8 }}>Tavolo</Text>
        <TextInput
          value={tavolo}
          onChangeText={onChangeTavolo}
          style={{ fontSize: 12, color: '#fff', fontWeight: 'bold', minWidth: 40, textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#555', paddingVertical: 2 }}
          placeholder="—" placeholderTextColor="#666"
          selectTextOnFocus
        />
      </View>
    </View>
  );

  const rigaHeader = (
    <View style={[g.riga, { minHeight: HEADER_H, backgroundColor: '#1a1a2e', paddingVertical: 3 }]}>
      <View style={g.labelCol} />
      <View style={g.colA}>
        {[0,1].map(i => (
          <View key={i} style={{ alignItems: 'center' }}>
            <TextInput value={nomiA[i] ?? ''} onChangeText={v => updArr(onChangeNomiA, i, v)}
              style={g.headerInput} placeholder={`Gioc.${i+1}`} placeholderTextColor="#666"
              selectTextOnFocus />
            <TextInput value={tessereA[i] ?? ''} onChangeText={v => updArr(onChangeTessereA, i, v)}
              style={g.headerInputTessera} placeholder="tessera" placeholderTextColor="#aaa"
              selectTextOnFocus />
          </View>
        ))}
      </View>
      <View style={g.colB}>
        {[0,1].map(i => (
          <View key={i} style={{ alignItems: 'center' }}>
            <TextInput value={nomiB[i] ?? ''} onChangeText={v => updArr(onChangeNomiB, i, v)}
              style={g.headerInput} placeholder={`Gioc.${i+1}`} placeholderTextColor="#666"
              selectTextOnFocus />
            <TextInput value={tessereB[i] ?? ''} onChangeText={v => updArr(onChangeTessereB, i, v)}
              style={g.headerInputTessera} placeholder="tessera" placeholderTextColor="#aaa"
              selectTextOnFocus />
          </View>
        ))}
      </View>
    </View>
  );

  const separatoreMano = (idx) => (
    <View key={`sep${idx}`} style={g.separatoreMano}>
      <Text style={g.separatoreT}>M{idx + 1}</Text>
    </View>
  );

  // Calcola il totale cumulativo atteso fino alla mano i (usando i valori scritti)
  const totPrec = (righe, i) => {
    let t = 0;
    for (let j = 0; j < i; j++) t += (Number(righe[j].base)||0) + (Number(righe[j].punti)||0);
    return t;
  };

  const rigaDati = (label, valA, valB, onA, onB, errA, errB, warnA, warnB, isBold, bgColor, sugA, sugB) => (
    <View style={[g.riga, { height: ROW_H, backgroundColor: bgColor }]}>
      <View style={g.labelCol}><Text style={[g.labelT, isBold && { fontWeight: 'bold', color: '#1a1a2e' }]}>{label}</Text></View>
      <View style={g.colA}><C value={valA} onChange={onA} errore={errA} warn={warnA} bold={isBold} suggerito={sugA} /></View>
      <View style={g.colB}><C value={valB} onChange={onB} errore={errB} warn={warnB} bold={isBold} suggerito={sugB} /></View>
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

    // Totale della mano precedente (base per tutti i calcoli)
    const prevTotA = i === 0 ? 0 : (Number(datiA[i-1].totale)||0);
    const prevTotB = i === 0 ? 0 : (Number(datiB[i-1].totale)||0);

    // Valore atteso per BASE: totale_scritto - totale_precedente - punti
    // Proposto solo se il risultato è multiplo di 50, altrimenti null (campo solo evidenziato)
    const _sugBaseA = (Number(datiA[i].totale)||0) - prevTotA - (Number(datiA[i].punti)||0);
    const _sugBaseB = (Number(datiB[i].totale)||0) - prevTotB - (Number(datiB[i].punti)||0);
    const sugBaseA = (!isNaN(_sugBaseA) && _sugBaseA % 50 === 0) ? _sugBaseA : null;
    const sugBaseB = (!isNaN(_sugBaseB) && _sugBaseB % 50 === 0) ? _sugBaseB : null;

    // Valore atteso per PUNTI: totale_scritto - totale_precedente - base
    const sugPuntiA = (Number(datiA[i].totale)||0) - prevTotA - (Number(datiA[i].base)||0);
    const sugPuntiB = (Number(datiB[i].totale)||0) - prevTotB - (Number(datiB[i].base)||0);

    // Valore atteso per TOTALE: totale_precedente + base + punti
    const sugTotA = prevTotA + (Number(datiA[i].base)||0) + (Number(datiA[i].punti)||0);
    const sugTotB = prevTotB + (Number(datiB[i].base)||0) + (Number(datiB[i].punti)||0);

    if (i > 0) mani.push(<View key={`div${i}`} style={g.divider} />);
    mani.push(
      <View key={`m${i}`}>
        {rigaDati('BASE',
          datiA[i].base, datiB[i].base,
          v => onChangeA(i, 'base', v), v => onChangeB(i, 'base', v),
          false, false,
          wA.some(w => w.smazzata === i+1 && w.tipo === 'BASE'),
          wB.some(w => w.smazzata === i+1 && w.tipo === 'BASE'),
          false, bg1, sugBaseA, sugBaseB)}
        {rigaDati('PUNTI',
          datiA[i].punti, datiB[i].punti,
          v => onChangeA(i, 'punti', v), v => onChangeB(i, 'punti', v),
          false, false,
          wA.some(w => w.smazzata === i+1 && w.tipo === 'PUNTI'),
          wB.some(w => w.smazzata === i+1 && w.tipo === 'PUNTI'),
          false, bg1, sugPuntiA, sugPuntiB)}
        {rigaDati('TOT',
          datiA[i].totale, datiB[i].totale,
          v => onChangeA(i, 'totale', v), v => onChangeB(i, 'totale', v),
          errA, errB, false, false, true, bg2, sugTotA, sugTotB)}
      </View>
    );
  }

  // Riepilogo
  const diffA = diff > 0 ? String(diff) : '';
  const diffB = diff < 0 ? String(Math.abs(diff)) : '';

  return (
    <View style={g.griglia}>
      {rigaTurnoTavolo}
      {rigaHeader}
      {mani}
      <View style={g.dividerRiepilogo} />
      {rigaStatica('TOT.',
        String(totA), String(totB),
        diff >= 0 ? '#2c5f2e' : '#2a1e12',
        diff < 0  ? '#2c5f2e' : '#2a1e12',
        '#fff')}
      {rigaStatica('DIFF.', diffA, diffB, '#2c5f2e', '#2c5f2e', '#f9f6f0')}
      <View style={[g.riga, { height: ROW_H, backgroundColor: '#fff' }]}>
        <View style={g.labelCol}><Text style={[g.labelT, { fontWeight: 'bold', color: '#1a1a2e' }]}>V.P.</Text></View>
        <View style={g.colA}>
          <CVP value={vpA} onChange={onChangeVpA}
            errore={ris?.erroriRiepilogo?.vpA}
            suggerito={vpCalc ? String(vpCalc.vpA) : null}
            coloreTesto={diff >= 0 ? '#2c5f2e' : '#2a1e12'} />
        </View>
        <View style={g.colB}>
          <CVP value={vpB} onChange={onChangeVpB}
            errore={ris?.erroriRiepilogo?.vpB}
            suggerito={vpCalc ? String(vpCalc.vpB) : null}
            coloreTesto={diff < 0 ? '#2c5f2e' : '#2a1e12'} />
        </View>
      </View>
      {vpCalc && rigaStatica('V.P.✓',
        String(vpCalc.vpA), String(vpCalc.vpB),
        diff >= 0 ? '#2c5f2e' : '#2a1e12',
        diff < 0  ? '#2c5f2e' : '#2a1e12',
        '#eafaf1')}
    </View>
  );
}

// ── Pannello risultato compatto ───────────────────────────────────────────────
function PannelloRisultato({ risultato, grigliaDaCondividere }) {
  const condividi = async () => {
    try {
      const uri = await captureRef(grigliaDaCondividere, { format: 'png', quality: 1.0 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Condividi punteggi' });
    } catch (e) {
      Alert.alert('Errore', 'Impossibile condividere lo screenshot.');
    }
  };

  // Sempre visibile: mostra "Tutto corretto" con pulsante condividi, oppure gli errori
  if (!risultato) return (
    <View style={[r.box, { backgroundColor: '#f5f5f5', borderColor: '#ddd' }]}>
      <Text style={{ color: '#aaa', fontSize: 13 }}>Inserisci i punteggi per la verifica</Text>
    </View>
  );
  const ris = risultato;
  if (ris.ok) return (
    <View style={[r.box, r.boxOk, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
      <Text style={r.ok}>✓ Tutto corretto</Text>
      <TouchableOpacity onPress={condividi}
        style={{ backgroundColor: '#2c5f2e', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>📤 Condividi</Text>
      </TouchableOpacity>
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
  const [attendibilita, setAttendibilitaState] = useState('basso');
  const [apiKeyInModifica, setApiKeyInModifica] = useState(false);
  const [apiKeyConferma, setApiKeyConferma] = useState('');
  const [apiKeyPassword, setApiKeyPassword] = useState(''); // password scelta durante prima config
  const [passwordInput, setPasswordInput] = useState(''); // input password per sblocco modifica
  const [primaConfig, setPrimaConfig] = useState(true); // true se mai configurata

  useEffect(() => {
    (async () => {
      const k = await SecureStore.getItemAsync(CHIAVE_STORAGE);
      if (k) { setApiKey(k); setSalvata(true); }
      const t = await SecureStore.getItemAsync(TABELLE_STORAGE);
      if (t) { try { setTabelle(JSON.parse(t)); } catch (_) {} } else { setTabelle(TABELLE_DEFAULT); }
      const ta = await SecureStore.getItemAsync(TABELLA_ATTIVA_STORAGE);
      if (ta) setTabellaAttivaId(ta);
      const att = await SecureStore.getItemAsync(ATTENDIBILITA_STORAGE);
      if (att) setAttendibilitaState(att);
      const pwd = await SecureStore.getItemAsync(PASSWORD_STORAGE);
      if (pwd) { setApiKeyPassword(pwd); setPrimaConfig(false); }
      setLoading(false);
    })();
  }, []);

  const salvaAttendibilita = async (val) => {
    setAttendibilitaState(val);
    await SecureStore.setItemAsync(ATTENDIBILITA_STORAGE, val);
  };

  const salvaApiKey = async () => {
    const p = apiKey.trim();
    if (!p.startsWith('sk-ant-')) { Alert.alert('Chiave non valida', 'Deve iniziare con "sk-ant-".'); return; }
    if (p !== apiKeyConferma.trim()) { Alert.alert('Errore', 'Le due chiavi inserite non coincidono.'); return; }
    if (primaConfig && !apiKeyPassword.trim()) { Alert.alert('Errore', 'Inserisci una password per proteggere la chiave.'); return; }
    Alert.alert(
      primaConfig ? 'Salva configurazione' : 'Conferma modifica',
      primaConfig ? 'Confermi di voler salvare la API key con questa password?' : 'Sei sicuro di voler cambiare la API key?',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Sì, salva', onPress: async () => {
          await SecureStore.setItemAsync(CHIAVE_STORAGE, p);
          if (primaConfig) await SecureStore.setItemAsync(PASSWORD_STORAGE, apiKeyPassword.trim());
          setSalvata(true);
          setPrimaConfig(false);
          setApiKeyInModifica(false);
          setApiKey(''); setApiKeyConferma(''); setPasswordInput('');
          Alert.alert('Salvata', primaConfig ? 'Configurazione completata.' : 'API key aggiornata.');
        }},
      ]
    );
  };
  const attivaModifica = () => {
    if (passwordInput.trim() !== apiKeyPassword) {
      Alert.alert('Password errata', 'La password inserita non è corretta.');
      return;
    }
    setApiKeyInModifica(true);
    setApiKey(''); setApiKeyConferma(''); setPasswordInput('');
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

        {/* ── 1. Tabelle VP ── */}
        <Text style={imp.sezione}>TABELLE VICTORY POINTS</Text>
        <Text style={imp.sub}>Seleziona la tabella per il calcolo dei VP.</Text>
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
        <View style={{ marginTop: 12 }}>
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
        </View>
        <TouchableOpacity style={[imp.btn, { backgroundColor: '#1a1a2e', marginTop: 14 }]} onPress={() => setEditor('nuova')}>
          <Text style={{ color: '#d4af37', fontWeight: 'bold' }}>+ Nuova tabella</Text>
        </TouchableOpacity>

        {/* ── 2. Attendibilità OCR ── */}
        <Text style={[imp.sezione, { marginTop: 28 }]}>ATTENDIBILITÀ OCR</Text>
        <Text style={imp.sub}>
          Basso: mostra sempre tutti i valori.{'\n'}
          Medio: nasconde i valori poco certi (sotto 60%).{'\n'}
          Alto: mostra solo i valori quasi certi (sopra 85%).
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {['basso', 'medio', 'alto'].map(livello => (
            <TouchableOpacity key={livello} onPress={() => salvaAttendibilita(livello)}
              style={[imp.btnAttendibilita, attendibilita === livello && imp.btnAttendibilitaOn]}>
              <Text style={[imp.btnAttendibilitaT, attendibilita === livello && { color: '#d4af37', fontWeight: 'bold' }]}>
                {livello.charAt(0).toUpperCase() + livello.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 3. API Key ── */}
        <Text style={[imp.sezione, { marginTop: 28 }]}>API KEY ANTHROPIC</Text>
        <Text style={imp.sub}>Necessaria per l'OCR. Ottieni la chiave su console.anthropic.com</Text>

        {primaConfig ? (
          <View>
            <Text style={[imp.sub, { marginBottom: 4 }]}>API Key:</Text>
            <TextInput style={imp.inputNome} value={apiKey} onChangeText={setApiKey} placeholder="sk-ant-..." placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={[imp.sub, { marginTop: 10, marginBottom: 4 }]}>Conferma API Key:</Text>
            <TextInput style={imp.inputNome} value={apiKeyConferma} onChangeText={setApiKeyConferma} placeholder="sk-ant-..." placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={[imp.sub, { marginTop: 10, marginBottom: 4 }]}>Password di protezione:</Text>
            <TextInput style={imp.inputNome} value={apiKeyPassword} onChangeText={setApiKeyPassword} placeholder="Scegli una password" placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={{ fontSize: 11, color: '#9a8a75', marginTop: 4 }}>Questa password servirà per modificare la chiave in futuro.</Text>
            {apiKey && apiKeyConferma && apiKey !== apiKeyConferma && (
              <Text style={{ color: '#e74c3c', fontSize: 12, marginTop: 4 }}>Le due chiavi non coincidono</Text>
            )}
            <TouchableOpacity style={[imp.btn, { backgroundColor: '#1a1a2e', marginTop: 12 }]} onPress={salvaApiKey}>
              <Text style={{ color: '#d4af37', fontWeight: 'bold' }}>Salva configurazione</Text>
            </TouchableOpacity>
          </View>
        ) : salvata && !apiKeyInModifica ? (
          <View>
            <Text style={imp.ok}>✓ Chiave attiva (nascosta per sicurezza)</Text>
            <Text style={[imp.sub, { marginTop: 12, marginBottom: 4 }]}>Inserisci password per modificare:</Text>
            <TextInput style={imp.inputNome} value={passwordInput} onChangeText={setPasswordInput} placeholder="Password" placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <TouchableOpacity style={[imp.btn, { borderWidth: 1.5, borderColor: '#1a1a2e', marginTop: 10 }]} onPress={attivaModifica}>
              <Text style={{ color: '#1a1a2e', fontWeight: 'bold' }}>✏ Sblocca modifica</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={[imp.sub, { marginBottom: 4 }]}>Nuova API Key:</Text>
            <TextInput style={imp.inputNome} value={apiKey} onChangeText={setApiKey} placeholder="sk-ant-..." placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={[imp.sub, { marginTop: 10, marginBottom: 4 }]}>Conferma API Key:</Text>
            <TextInput style={imp.inputNome} value={apiKeyConferma} onChangeText={setApiKeyConferma} placeholder="sk-ant-..." placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
            {apiKey && apiKeyConferma && apiKey !== apiKeyConferma && (
              <Text style={{ color: '#e74c3c', fontSize: 12, marginTop: 4 }}>Le due chiavi non coincidono</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={[imp.btn, { flex: 2, backgroundColor: '#1a1a2e' }]} onPress={salvaApiKey}>
                <Text style={{ color: '#d4af37', fontWeight: 'bold' }}>Salva</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[imp.btn, { flex: 1, borderWidth: 1.5, borderColor: '#c8b89a' }]} onPress={() => { setApiKeyInModifica(false); setApiKey(''); setApiKeyConferma(''); setPasswordInput(''); }}>
                <Text style={{ color: '#7a6a55' }}>Annulla</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

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
  const [turno, setTurno] = useState('');
  const [tavolo, setTavolo] = useState('');
  const [nomiA, setNomiA] = useState(['', '']);
  const [tessereA, setTessereA] = useState(['', '']);
  const [nomiB, setNomiB] = useState(['', '']);
  const [tessereB, setTessereB] = useState(['', '']);
  const [datiA, setDatiA] = useState(vuoto());
  const [datiB, setDatiB] = useState(vuoto());
  const [vpA, setVpA] = useState('');
  const [vpB, setVpB] = useState('');
  const [risultato, setRisultato] = useState(null);
  const [foto, setFoto] = useState(null);
  const [fotoZoom, setFotoZoom] = useState(false);
  const [stato, setStato] = useState('idle'); // idle | analisi | errore
  const [erroreMsg, setErroreMsg] = useState('');
  const [apiKey, setApiKey] = useState(null);
  const [tabella, setTabella] = useState(TABELLA_DEFAULT);
  const [attendibilita, setAttendibilita] = useState('basso');
  const [pagina, setPagina] = useState(1); // 0=foto, 1=griglia
  const pagerRef = useRef(null);
  const grigliaRef = useRef(null);

  useEffect(() => {
    const carica = async () => {
      const k = await SecureStore.getItemAsync(CHIAVE_STORAGE);
      setApiKey(k ?? null);
      const t = await SecureStore.getItemAsync(TABELLE_STORAGE);
      const tabs = t ? JSON.parse(t) : TABELLE_DEFAULT;
      const ta = await SecureStore.getItemAsync(TABELLA_ATTIVA_STORAGE) ?? 'default';
      setTabella(tabs.find(x => x.id === ta) ?? TABELLA_DEFAULT);
      const att = await SecureStore.getItemAsync(ATTENDIBILITA_STORAGE);
      if (att) setAttendibilita(att);
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
    const vuotoArr = Array.from({ length: SMAZZATE }, () => ({ base: '', punti: '', totale: '' }));
    setDatiA(vuotoArr); setDatiB(vuotoArr);
    setTurno(''); setTavolo('');
    setNomiA(['', '']); setTessereA(['', '']);
    setNomiB(['', '']); setTessereB(['', '']);
    setVpA(''); setVpB('');
    pagerRef.current?.scrollTo({ x: 0, animated: true });
    setPagina(0);
    try {
      const dati = await estraiDatiDaFoto(uri, apiKey);
      const soglia = SOGLIA_ATTENDIBILITA[attendibilita] ?? 0;

      // ── Imposta sempre: anagrafica e dati del turno ───────────────────────
      setTurno(dati.turno ?? '');
      setTavolo(dati.tavolo ?? '');
      setNomiA(dati.nomiA?.length ? dati.nomiA : ['', '']);
      setTessereA(dati.tessereA?.length ? dati.tessereA : ['', '']);
      setNomiB(dati.nomiB?.length ? dati.nomiB : ['', '']);
      setTessereB(dati.tessereB?.length ? dati.tessereB : ['', '']);

      // ── Imposta sempre: VP letti (con filtro confidenza) e totali riepilogo ──
      const filtraConf = (val, conf) => {
        const n = parseValore(val);
        return (Number(conf) || 0) >= soglia ? String(n) : '';
      };
      setVpA(filtraConf(dati.vpA, dati.vpAC));
      setVpB(filtraConf(dati.vpB, dati.vpBC));

      // ── Validazione backwards per ogni coppia indipendentemente ──────────
      // Legge i valori grezzi con le loro confidenze
      const leggi = (sm, lato) => ({
        base:   parseValore(sm[lato].base),
        baseC:  Number(sm[lato].baseC)  || 0,
        punti:  parseValore(sm[lato].punti),
        puntiC: Number(sm[lato].puntiC) || 0,
        totale: parseValore(sm[lato].totale),
        totaleC:Number(sm[lato].totaleC)|| 0,
      });

      const valida = (lato) => {
        // Risultato: array di 4 oggetti {base, punti, totale} o stringa vuota per campo non affidabile
        const risultato = Array.from({ length: SMAZZATE }, () => ({ base: '', punti: '', totale: '' }));
        const sm = dati.smazzate.map(s => leggi(s, lato));

        // Partenza: totale della mano 4 (indice 3)
        // Lo inseriamo sempre se confidenza >= soglia
        const tot4 = sm[3];
        if (tot4.totaleC < soglia) return risultato; // totale riepilogativo inaffidabile → tutto vuoto

        risultato[3].totale = String(tot4.totale);

        // Scorro da mano 4 (i=3) verso mano 1 (i=0)
        for (let i = 3; i >= 0; i--) {
          const m = sm[i];
          const prevTot = i > 0 ? parseValore(risultato[i-1].totale) : 0;

          // Vincolo multipli (propedeutico)
          const baseOk   = m.base  % 50 === 0;
          const puntiOk  = m.punti % 5  === 0;

          // Confidenza sufficiente?
          const baseAff   = m.baseC  >= soglia;
          const puntiAff  = m.puntiC >= soglia;

          // Se base o punti non rispettano il vincolo o sono inaffidabili: fermati
          if (!baseOk || !puntiOk || !baseAff || !puntiAff) {
            // Azzera questa mano e tutte le precedenti
            for (let j = i; j >= 0; j--) {
              risultato[j] = { base: '', punti: '', totale: '' };
            }
            break;
          }

          // Verifica matematica: prevTot + base + punti deve == totale scritto
          const totAtteso = prevTot + m.base + m.punti;

          if (i === 3) {
            // Mano 4: già inserito il totale, verifichiamo base e punti
            if (totAtteso !== tot4.totale) {
              // Non torna: lascia base e punti vuoti per questa mano e tutte le precedenti
              risultato[3].base  = '';
              risultato[3].punti = '';
              for (let j = 2; j >= 0; j--) {
                risultato[j] = { base: '', punti: '', totale: '' };
              }
              break;
            }
            risultato[3].base  = String(m.base);
            risultato[3].punti = String(m.punti);
          } else {
            // Mani 1-3: verifichiamo che il totale precedente sia coerente
            // totale[i] deve essere uguale a totale[i+1] - base[i+1] - punti[i+1]
            // ovvero prevTot = risultato[i].totale deve essere già inserito
            // e base[i] + punti[i] + prevTot == totale[i+1] - già verificato al passo i+1

            // Verifica che totale[i] (già inserito) sia coerente con base[i] e punti[i]
            const totCorrente = parseValore(risultato[i].totale);
            if (totCorrente === '' || isNaN(totCorrente)) {
              // totale di questa mano non disponibile → fermati
              for (let j = i; j >= 0; j--) {
                risultato[j] = { base: '', punti: '', totale: '' };
              }
              break;
            }

            if (prevTot + m.base + m.punti !== totCorrente) {
              // Non torna: lascia base e punti vuoti, e svuota tutto il precedente
              risultato[i].base  = '';
              risultato[i].punti = '';
              for (let j = i-1; j >= 0; j--) {
                risultato[j] = { base: '', punti: '', totale: '' };
              }
              break;
            }
            risultato[i].base  = String(m.base);
            risultato[i].punti = String(m.punti);

            // Inserisci il totale della mano precedente (i-1) se i > 0
            if (i > 0) {
              const prevM = sm[i-1];
              if (prevM.totaleC >= soglia) {
                risultato[i-1].totale = String(prevM.totale);
              } else {
                // Totale mano precedente inaffidabile: calcola dal totale corrente
                risultato[i-1].totale = String(totCorrente - m.base - m.punti);
              }
            }
          }
        }
        return risultato;
      };

      const nA = valida('a');
      const nB = valida('b');
      setDatiA(nA);
      setDatiB(nB);
      setStato('idle');
      setTimeout(() => { setPagina(1); }, 100);
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
      // NON chiamare salvaInAlbumBurraco qui: causerebbe il dialogo "modifica foto"
      // La fotocamera Android salva già in DCIM automaticamente
      elaboraFoto(res.assets[0].uri);
    }
  };

  const caricaDaLibreria = async () => {
    if (!controllaApiKey()) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permesso negato', "Consenti l'accesso alla galleria."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1.0, base64: false });
    if (!res.canceled && res.assets?.[0]?.uri) {
      // Reset esplicito prima di elaborare — evita che rimangano dati vecchi
      const vuotoArr = Array.from({ length: SMAZZATE }, () => ({ base: '', punti: '', totale: '' }));
      setDatiA(vuotoArr); setDatiB(vuotoArr);
      setTurno(''); setTavolo('');
      setNomiA(['', '']); setTessereA(['', '']);
      setNomiB(['', '']); setTessereB(['', '']);
      setVpA(''); setVpB('');
      elaboraFoto(res.assets[0].uri);
    }
  };

  const reset = () => {
    setDatiA(vuoto()); setDatiB(vuoto());
    setTurno(''); setTavolo('');
    setNomiA(['', '']); setTessereA(['', '']);
    setNomiB(['', '']); setTessereB(['', '']);
    setVpA(''); setVpB(''); setRisultato(null); setFoto(null); setFotoZoom(false); setStato('idle'); setErroreMsg('');
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
        <>
          {/* Modal fullscreen zoom — si apre al tap, swipe pager sempre libero */}
          <Modal visible={fotoZoom} transparent={false} animationType="fade" statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              <TouchableOpacity onPress={() => setFotoZoom(false)}
                style={{ position: 'absolute', top: 48, right: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold' }}>✕</Text>
              </TouchableOpacity>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', minHeight: SH }}
                maximumZoomScale={8} minimumZoomScale={1}
                centerContent bouncesZoom
                showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
              >
                <Image source={{ uri: foto }} style={{ width: SW, height: SH * 0.9 }} resizeMode="contain" />
              </ScrollView>
            </View>
          </Modal>
          {/* Immagine statica: swipe pager sempre libero, tap apre Modal zoom */}
          <TouchableOpacity onPress={() => setFotoZoom(true)} style={{ flex: 1, backgroundColor: '#000' }} activeOpacity={0.85}>
            <Image source={{ uri: foto }} style={{ width: SW, flex: 1 }} resizeMode="contain" />
            <View style={{ position: 'absolute', bottom: 6, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 11 }}>🔍 Tocca per zoom</Text>
            </View>
          </TouchableOpacity>
          <View style={h.fotoBar}>
            <TouchableOpacity style={h.btnFotoBar} onPress={scattaFoto}><Text style={h.btnFotoBarT}>📷 Nuova</Text></TouchableOpacity>
            <TouchableOpacity style={h.btnFotoBar} onPress={caricaDaLibreria}><Text style={h.btnFotoBarT}>🖼 Libreria</Text></TouchableOpacity>
            <TouchableOpacity style={[h.btnFotoBar, { borderColor: '#7a6a55' }]} onPress={reset}><Text style={[h.btnFotoBarT, { color: '#7a6a55' }]}>↺ Reset</Text></TouchableOpacity>
          </View>
        </>
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
    </View>
  );

  // Pagina 1: griglia
  const paginaGriglia = (
    <View style={{ width: SW, flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">

        <View ref={grigliaRef} collapsable={false}>
        <Griglia
          datiA={datiA} datiB={datiB} vpA={vpA} vpB={vpB}
          onChangeA={(i, k, v) => aggiorna(setDatiA, i, k, v)}
          onChangeB={(i, k, v) => aggiorna(setDatiB, i, k, v)}
          onChangeVpA={v => setVpA(v)} onChangeVpB={v => setVpB(v)}
          risultato={risultato} tabella={tabella}
          nomiA={nomiA} nomiB={nomiB}
          tessereA={tessereA} tessereB={tessereB}
          turno={turno} tavolo={tavolo}
          onChangeNomiA={v => setNomiA(v)} onChangeNomiB={v => setNomiB(v)}
          onChangeTessereA={v => setTessereA(v)} onChangeTessereB={v => setTessereB(v)}
          onChangeTurno={v => setTurno(v)} onChangeTavolo={v => setTavolo(v)}
        />
        </View>
        <PannelloRisultato risultato={risultato} grigliaDaCondividere={grigliaRef} />
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
  headerInput: { fontSize: 11, color: '#d4af37', fontWeight: 'bold', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#d4af3766', paddingVertical: 1, minWidth: 60 },
  headerInputTessera: { fontSize: 9, color: '#ffffff', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#ffffff44', paddingVertical: 1, minWidth: 40 },
  headerTessera: { fontSize: 11, color: '#ffffff', textAlign: 'center', letterSpacing: 0.5, fontWeight: 'bold' },
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
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', paddingHorizontal: 12, paddingVertical: 10, paddingTop: 28 },
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
  btnAttendibilita: { flex: 1, borderWidth: 1.5, borderColor: '#c8b89a', borderRadius: 8, padding: 10, alignItems: 'center', backgroundColor: '#fff' },
  btnAttendibilitaOn: { borderColor: '#1a1a2e', backgroundColor: '#1a1a2e' },
  btnAttendibilitaT: { fontSize: 13, color: '#7a6a55' },
});
