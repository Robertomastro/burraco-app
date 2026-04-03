// Burraco Score - SDK 52 - navigazione via stato, zero dipendenze native extra
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Image, SafeAreaView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';

const CHIAVE_STORAGE = 'anthropic_api_key';
const SMAZZATE = 4;

const SYSTEM_PROMPT = `Sei un assistente specializzato nel leggere segnapunti di Burraco tradizionale.
Il foglio ha due colonne (Coppia A e Coppia B) e 4 smazzate o mani.
Ogni smazzata ha tre righe: BASE, PUNTI, TOTALE.
Restituisci SOLO un oggetto JSON valido, senza markdown, senza testo aggiuntivo:
{
  "nomiA": ["nome1", "nome2"],
  "nomiB": ["nome1", "nome2"],
  "smazzate": [
    { "a": { "base": 0, "punti": 0, "totale": 0 }, "b": { "base": 0, "punti": 0, "totale": 0 } },
    { "a": { "base": 0, "punti": 0, "totale": 0 }, "b": { "base": 0, "punti": 0, "totale": 0 } },
    { "a": { "base": 0, "punti": 0, "totale": 0 }, "b": { "base": 0, "punti": 0, "totale": 0 } },
    { "a": { "base": 0, "punti": 0, "totale": 0 }, "b": { "base": 0, "punti": 0, "totale": 0 } }
  ]
}
Regole: campi vuoti o illeggibili -> 0. Nomi non visibili -> "". Solo JSON, nulla altro.`;

function verificaColonna(righe, etichetta) {
  const errori = [];
  let totPrec = 0;
  righe.forEach((r, i) => {
    const b = Number(r.base) || 0;
    const p = Number(r.punti) || 0;
    const t = Number(r.totale);
    const atteso = totPrec + b + p;
    if (r.base === '' && r.punti === '' && r.totale === '') return;
    if (t !== atteso) errori.push({ smazzata: i + 1, colonna: etichetta, scritto: t, atteso });
    totPrec = atteso;
  });
  return errori;
}

function testoErrori(n) { return n === 1 ? '1 errore trovato' : `${n} errori trovati`; }

async function estraiDatiDaFoto(base64, apiKey) {
  const risposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: 'Estrai tutti i punteggi da questo segnapunti di Burraco.' },
      ]}],
    }),
  });
  if (!risposta.ok) { const err = await risposta.json().catch(() => ({})); throw new Error(err?.error?.message ?? `Errore API: ${risposta.status}`); }
  const dati = await risposta.json();
  const testo = dati.content.find(b => b.type === 'text')?.text ?? '';
  return JSON.parse(testo.replace(/```json|```/g, '').trim());
}

function Campo({ value, onChange, errore }) {
  return (
    <TextInput keyboardType="number-pad" value={value} onChangeText={onChange}
      style={[s.input, errore && s.inputErr]} placeholder="—" placeholderTextColor="#bbb" selectTextOnFocus />
  );
}

function BloccoMano({ idx, datiA, datiB, onChangeA, onChangeB, erroriA, erroriB }) {
  const righe = [{ k: 'base', label: 'BASE' }, { k: 'punti', label: 'PUNTI' }, { k: 'totale', label: 'TOTALE' }];
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
          <View style={s.col}><Campo value={datiA[k]} onChange={v => onChangeA(idx, k, v)} errore={k === 'totale' && erroriA.includes(idx)} /></View>
          <View style={s.col}><Campo value={datiB[k]} onChange={v => onChangeB(idx, k, v)} errore={k === 'totale' && erroriB.includes(idx)} /></View>
        </View>
      ))}
    </View>
  );
}

function SchermatImpostazioni({ onTorna }) {
  const [apiKey, setApiKey] = useState('');
  const [salvata, setSalvata] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  useEffect(() => { SecureStore.getItemAsync(CHIAVE_STORAGE).then(k => { if (k) { setApiKey(k); setSalvata(true); } setCaricamento(false); }); }, []);
  const salva = async () => {
    const pulita = apiKey.trim();
    if (!pulita.startsWith('sk-ant-')) { Alert.alert('Chiave non valida', 'La API key deve iniziare con "sk-ant-". Controllala su console.anthropic.com'); return; }
    await SecureStore.setItemAsync(CHIAVE_STORAGE, pulita); setSalvata(true); Alert.alert('Salvata', 'API key salvata correttamente.');
  };
  const elimina = async () => { Alert.alert('Elimina chiave', 'Sei sicuro?', [{ text: 'Annulla', style: 'cancel' }, { text: 'Elimina', style: 'destructive', onPress: async () => { await SecureStore.deleteItemAsync(CHIAVE_STORAGE); setApiKey(''); setSalvata(false); } }]); };
  if (caricamento) return <View style={s.centrato}><ActivityIndicator color="#d4af37" size="large" /></View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5efe6' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}><Text style={s.titolo}>BURRACO</Text><Text style={s.sottotitolo}>Impostazioni</Text></View>
        <View style={s.card}>
          <Text style={s.cardTitolo}>API Key Anthropic</Text>
          <Text style={s.testo}>L'app usa l'AI di Anthropic per leggere il segnapunti.{'\n\n'}Ogni utente usa la propria chiave personale. Il costo per analisi e' inferiore a 1 centesimo. Anthropic offre credito gratuito iniziale.</Text>
          <Text style={s.passiTitolo}>Come ottenere la tua API key:</Text>
          {['Vai su console.anthropic.com','Registrati o accedi','Menu a sinistra -> "API Keys"','Clicca "Create Key"','Copia la chiave e incollala qui sotto'].map((p, i) => (
            <Text key={i} style={s.passo}><Text style={s.passoNum}>{i + 1}. </Text>{p}</Text>
          ))}
        </View>
        <View style={s.card}>
          <Text style={s.inputLabel}>La tua API Key</Text>
          <TextInput style={s.inputNome} value={apiKey} onChangeText={v => { setApiKey(v); setSalvata(false); }} placeholder="sk-ant-..." placeholderTextColor="#9a8a75" autoCapitalize="none" autoCorrect={false} secureTextEntry />
          {salvata && <Text style={s.salvataMsg}>✓ Chiave salvata e attiva</Text>}
        </View>
        <View style={s.pulsanti}>
          <TouchableOpacity style={s.btnVerifica} onPress={salva}><Text style={s.btnVerificaT}>Salva</Text></TouchableOpacity>
          {salvata && <TouchableOpacity style={[s.btnReset, { borderColor: '#e74c3c' }]} onPress={elimina}><Text style={[s.btnResetT, { color: '#e74c3c' }]}>Elimina</Text></TouchableOpacity>}
        </View>
        <TouchableOpacity style={{ padding: 16, alignItems: 'center' }} onPress={onTorna}><Text style={{ color: '#7a6a55', fontSize: 14 }}>← Torna all'app</Text></TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SchermatHome({ onImpostazioni }) {
  const vuoto = () => Array.from({ length: SMAZZATE }, () => ({ base: '', punti: '', totale: '' }));
  const [nomiA, setNomiA] = useState(['', '']);
  const [nomiB, setNomiB] = useState(['', '']);
  const [datiA, setDatiA] = useState(vuoto());
  const [datiB, setDatiB] = useState(vuoto());
  const [risultato, setRisultato] = useState(null);
  const [anteprima, setAnteprima] = useState(null);
  const [stato, setStato] = useState('idle');
  const [erroreMsg, setErroreMsg] = useState('');
  const [apiKey, setApiKey] = useState(null);

  useEffect(() => { const carica = () => SecureStore.getItemAsync(CHIAVE_STORAGE).then(k => setApiKey(k ?? null)); carica(); const t = setInterval(carica, 1500); return () => clearInterval(t); }, []);

  const calcolaRisultato = (a, b) => { const ea = verificaColonna(a, 'A'); const eb = verificaColonna(b, 'B'); const tutti = [...ea, ...eb]; return { ok: tutti.length === 0, errori: tutti, indiciErrA: ea.map(e => e.smazzata - 1), indiciErrB: eb.map(e => e.smazzata - 1) }; };
  const aggiorna = useCallback((setter, idx, campo, valore) => { setter(prev => { const c = prev.map(r => ({ ...r })); c[idx][campo] = valore; return c; }); setRisultato(null); }, []);

  const controllaApiKey = () => { if (!apiKey) { Alert.alert('API Key mancante', 'Configura la tua API key nelle impostazioni.', [{ text: 'Impostazioni', onPress: onImpostazioni }, { text: 'Annulla' }]); return false; } return true; };

  const scattaFoto = async () => {
    if (!controllaApiKey()) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permesso negato', "Consenti l'accesso alla fotocamera."); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, base64: true });
    if (!res.canceled) elaboraFoto(res.assets[0]);
  };

  const caricaDaLibreria = async () => {
    if (!controllaApiKey()) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permesso negato', "Consenti l'accesso alla libreria foto."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, base64: true });
    if (!res.canceled) elaboraFoto(res.assets[0]);
  };

  const elaboraFoto = async (asset) => {
    setAnteprima(asset.uri); setStato('analisi'); setRisultato(null); setErroreMsg('');
    try {
      const dati = await estraiDatiDaFoto(asset.base64, apiKey);
      const toStr = v => (!v || v === 0) ? '' : String(v);
      const nuoviA = dati.smazzate.map(sm => ({ base: toStr(sm.a.base), punti: toStr(sm.a.punti), totale: toStr(sm.a.totale) }));
      const nuoviB = dati.smazzate.map(sm => ({ base: toStr(sm.b.base), punti: toStr(sm.b.punti), totale: toStr(sm.b.totale) }));
      setNomiA(dati.nomiA?.length ? dati.nomiA : ['', '']); setNomiB(dati.nomiB?.length ? dati.nomiB : ['', '']);
      setDatiA(nuoviA); setDatiB(nuoviB); setRisultato(calcolaRisultato(nuoviA, nuoviB)); setStato('fatto');
    } catch (e) { setStato('errore'); setErroreMsg(e.message); }
  };

  const verifica = () => setRisultato(calcolaRisultato(datiA, datiB));
  const reset = () => { setDatiA(vuoto()); setDatiB(vuoto()); setNomiA(['', '']); setNomiB(['', '']); setRisultato(null); setAnteprima(null); setStato('idle'); setErroreMsg(''); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5efe6' }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Text style={s.titolo}>BURRACO</Text>
          <Text style={s.sottotitolo}>Verifica Punteggi</Text>
          <TouchableOpacity style={s.btnImp} onPress={onImpostazioni}><Text style={s.btnImpT}>⚙ Impostazioni</Text></TouchableOpacity>
        </View>

        <View style={{ padding: 14 }}>
          {stato === 'analisi' ? (
            <View style={s.loading}><ActivityIndicator color="#d4af37" size="large" /><Text style={s.loadingT}>Analisi in corso…</Text></View>
          ) : anteprima ? (
            <View style={{ gap: 8 }}>
              <Image source={{ uri: anteprima }} style={s.anteprima} resizeMode="cover" />
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
              erroriA={risultato?.indiciErrA ?? []} erroriB={risultato?.indiciErrB ?? []} />
          ))}
        </View>

        <View style={s.pulsanti}>
          <TouchableOpacity style={s.btnReset} onPress={reset}><Text style={s.btnResetT}>↺ Reset</Text></TouchableOpacity>
          <TouchableOpacity style={s.btnVerifica} onPress={verifica}><Text style={s.btnVerificaT}>✓ Verifica</Text></TouchableOpacity>
        </View>

        {risultato && (
          <View style={[s.risultatoBox, risultato.ok ? s.boxOk : s.boxErr]}>
            {risultato.ok ? (
              <View style={s.rigaOk}><Text style={s.iconaOk}>✓</Text><View><Text style={s.testoOk}>Tutti i totali sono corretti!</Text><Text style={s.subOk}>Nessun errore in entrambe le colonne.</Text></View></View>
            ) : (
              <View>
                <View style={s.rigaErrHeader}><Text style={s.iconaErr}>✗</Text><Text style={s.testoErr}>{testoErrori(risultato.errori.length)}</Text></View>
                {risultato.errori.map((e, i) => (
                  <View key={i} style={s.rigaErrore}>
                    <View style={[s.tag, { backgroundColor: e.colonna === 'A' ? '#2c5f2e' : '#7a2230', width: 20, height: 20 }]}><Text style={[s.tagT, { fontSize: 11 }]}>{e.colonna}</Text></View>
                    <View>
                      <Text style={s.errDet}>Mano {e.smazzata} — scritto <Text style={{ fontWeight: 'bold' }}>{e.scritto}</Text>, atteso <Text style={{ fontWeight: 'bold' }}>{e.atteso}</Text></Text>
                      <Text style={s.errDiff}>Differenza: {e.atteso - e.scritto > 0 ? '+' : ''}{e.atteso - e.scritto} punti</Text>
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
  btnRiga: { flexDirection: 'row', gap: 10 },
  btnScan: { flex: 1, backgroundColor: '#1a1a2e', borderWidth: 2, borderColor: '#d4af37', borderStyle: 'dashed', borderRadius: 12, padding: 18, alignItems: 'center', gap: 4 },
  btnScanIcona: { fontSize: 28 },
  btnScanT: { color: '#d4af37', fontSize: 14, fontWeight: 'bold' },
  anteprima: { width: '100%', height: 180, borderRadius: 10, borderWidth: 2, borderColor: '#d4af37' },
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
  input: { borderWidth: 1.5, borderColor: '#c8b89a', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 4, fontSize: 16, textAlign: 'center', color: '#2a1e12', backgroundColor: '#fffdf8', width: '92%' },
  inputErr: { borderColor: '#e74c3c', backgroundColor: '#fff0ee' },
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
  errDet: { fontSize: 13, color: '#5a2020' },
  errDiff: { fontSize: 11, color: '#c0392b', marginTop: 2 },
  card: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#ddd0b8' },
  cardTitolo: { fontSize: 13, fontWeight: 'bold', color: '#3a2e22', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  testo: { fontSize: 14, color: '#5a4a3a', lineHeight: 21 },
  passiTitolo: { fontSize: 13, fontWeight: 'bold', color: '#3a2e22', marginTop: 14, marginBottom: 8 },
  passo: { fontSize: 13, color: '#5a4a3a', marginBottom: 5, lineHeight: 19 },
  passoNum: { color: '#d4af37', fontWeight: 'bold' },
  inputLabel: { fontSize: 11, letterSpacing: 1.5, color: '#7a6a55', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: 8 },
  salvataMsg: { marginTop: 8, fontSize: 13, color: '#2c5f2e', fontWeight: 'bold' },
});
