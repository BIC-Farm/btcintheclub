# btcintheclub

La community di Bitcoin in the Club è una delle più importanti community Bitcoin only in Italia. Mettiamo insieme studiosi, curiosi, newbie e scettici 
in un unico grande contenitore open source e pronto a formare e condividere conoscenze e competenze in tutta trasparenza.

## Block Explorer per Newbies

Questo repository contiene un **block explorer Bitcoin semplice e intuitivo**, pensato per chi si avvicina
per la prima volta a Bitcoin. Permette di cercare e consultare blocchi, transazioni e indirizzi con
spiegazioni in linguaggio semplice, senza gergo tecnico ostico, e un glossario integrato per chi non
conosce i termini.

Funzionalità principali:

- **Ricerca unica**: incolla un'altezza di blocco, un hash (blocco o transazione) oppure un indirizzo
  Bitcoin e verrai portato direttamente alla pagina giusta.
- **Home page** con gli ultimi 6 blocchi minati, transazioni in attesa (mempool) e fee consigliate,
  ciascuna con un piccolo tooltip "?" che spiega il termine.
- **Tutti i blocchi** (`#/blocchi`): l'elenco completo dei blocchi, con paginazione "Carica altri
  blocchi" per risalire la catena a ritroso senza limiti, e un effetto di comparsa a cascata (le righe
  si animano in sequenza) che rende la navigazione più dinamica e "da gioco".
- **Block Clock**: un orologio live che mostra da quanto tempo non si trova un nuovo blocco, con un anello
  di progresso verso la media di ~10 minuti e un punto luminoso che lo percorre in tempo reale. Aggiorna il
  conteggio ogni secondo e rileva da solo l'arrivo di un nuovo blocco, festeggiandolo con un effetto ping,
  il numero che rimbalza e un messaggio celebrativo temporaneo — senza mai ricaricare la pagina.
- **Mining** (`#/mining`, in header): lo stato del mining in tempo reale spiegato in parole semplici —
  hashrate della rete, countdown al prossimo aggiustamento della difficoltà, e un **countdown live al
  prossimo halving** (barra di progresso sull'epoca corrente, blocchi rimanenti, ricompensa attuale/futura
  nell'unità scelta BTC o sats) che si aggiorna da solo non appena arriva un nuovo blocco, senza ricaricare
  la pagina. Include anche i pool di mining più attivi dell'ultima settimana con relativa percentuale di
  blocchi trovati. Ogni sezione si carica in modo indipendente e ha un proprio pulsante "Riprova" se i dati
  non arrivano, così un problema su una singola fonte non blocca tutta la pagina. La card dei pool ricorda
  esplicitamente che le quote sono etichette rilevate da mempool.space (non un dato verificabile
  crittograficamente), che i miner possono cambiare pool in pochi minuti, e che nessun pool può da solo
  cambiare le regole del protocollo.
- **Dettaglio blocco**: informazioni principali in evidenza, dettagli tecnici avanzati (nonce, difficoltà,
  merkle root, ecc.) nascosti dietro un pannello a scomparsa, elenco transazioni con paginazione, e una
  **mappa visiva della composizione del blocco**: un mosaico di rettangoli (uno per transazione, dati reali
  scaricati al momento), con area proporzionale al peso e colore in base alla fee pagata — passa il mouse
  per i dettagli, clicca per aprire la transazione.
- **Dettaglio transazione**: stato (confermata / in attesa), numero di conferme, spiegazione in parole
  semplici di chi ha inviato cosa a chi, elenco input/output.
- **Dettaglio indirizzo**: saldo attuale, totale ricevuto, cronologia transazioni con importi in
  entrata/uscita evidenziati.
- **Glossario** (`#/glossario`) con oltre 20 termini di Bitcoin spiegati in italiano semplice. Ogni
  parola tecnica che compare nell'app (hash, fee, conferme, input/output, nonce, difficoltà, ecc.) è
  un link sottolineato che porta dritto alla voce corrispondente del glossario, evidenziata al volo.
- **Pulsanti "copia"** su hash, txid e indirizzi, per non dover selezionare a mano testi lunghi.
- **Grafica "liquid glass"**: pannelli traslucidi con effetto vetro smerigliato, sfondo a gradiente
  soffuso, forme arrotondate e tema chiaro/scuro automatico in base alle preferenze di sistema.
- **Guide** (`#/guide`) con approfondimenti pratici per chi inizia: come proteggere la seed phrase,
  custodial vs non-custodial, come scegliere il primo wallet, le truffe Bitcoin più comuni, come funzionano
  fee e conferme, e le basi della privacy su Bitcoin.
- **Toggle BTC / sats** in header: cambia l'unità di visualizzazione di tutti gli importi con un click,
  preferenza salvata in locale così resta impostata anche ai visite successive.
- **Genera una seed con i dadi** (`#/guide/dadi-seed`, dentro la sezione Guide): demo didattica che mostra
  come dei tiri di dado fisico diventano una mnemonic BIP39 (entropia via SHA-256 nativo del browser,
  wordlist inglese ufficiale). Si sblocca solo a connessione disattivata (`navigator.onLine`) e si
  riblocca subito se torna online; le parole non vengono mai salvate, inviate in rete o copiabili, e sono
  pensate esplicitamente **per capire il meccanismo**, non per generare un wallet con fondi reali — per
  quello resta valido il consiglio della guida "Seed sicura": usare un hardware wallet dedicato. È promossa
  con una card dedicata in home e con un badge "Interattivo" nell'indice delle guide, per renderla facile
  da scoprire.
- **Scegli il tuo portafoglio** (`#/guide/scegli-wallet`, dentro la sezione Guide): versione semplificata,
  pensata per chi inizia, dello strumento di [bitcoin.org/it/scegli-il-tuo-portafoglio](https://bitcoin.org/it/scegli-il-tuo-portafoglio).
  Tre filtri in linguaggio semplice (dove vuoi usarlo, per cosa, quanto vuoi che sia semplice) restringono
  un elenco curato di 9 wallet non-custodial affidabili e conosciuti (mobile, desktop, hardware), ciascuno
  con una spiegazione in una frase e badge come "Open source" o "Lightning". Di proposito non contiene link
  diretti di download verso i singoli siti dei wallet: rimanda sempre alla lista ufficiale di bitcoin.org e
  ricorda esplicitamente il rischio di siti clone/phishing, con link al termine corrispondente nel glossario.

### Come funziona

È un sito statico (HTML + CSS + JavaScript vanilla, nessuna build necessaria) che recupera i dati in
tempo reale dalle API pubbliche di [mempool.space](https://mempool.space). Non servono chiavi API né
un backend proprio.

### Come avviarlo in locale

Basta servire la cartella del progetto con un qualsiasi server statico, ad esempio:

```bash
python3 -m http.server 8000
# poi apri http://localhost:8000
```

oppure, se hai Node.js installato:

```bash
npx serve .
```

### Struttura del progetto

```
index.html        pagina principale (header, barra di ricerca, contenitore app)
css/styles.css     stile dell'interfaccia
js/api.js          chiamate alle API di mempool.space
js/format.js       funzioni di formattazione (date, importi, hash abbreviati, ecc.)
js/app.js          router e logica delle varie viste (home, blocco, transazione, indirizzo, glossario)
```
