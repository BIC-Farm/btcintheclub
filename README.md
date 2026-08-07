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
  il numero che rimbalza e un messaggio celebrativo temporaneo — senza mai ricaricare la pagina. Un link
  "⛶ Modalità schermo intero" apre **`#/blockclock`**, una pagina dedicata senza header/footer con
  un'edizione grande dello stesso orologio, pensata per restare aperta su un monitor o tablet dedicato come
  display sempre acceso; un pulsante richiama anche la Fullscreen API del browser per nascondere pure la
  barra degli indirizzi.
- **Mining** (`#/mining`, in header): lo stato del mining in tempo reale spiegato in parole semplici —
  **grafico storico dell'hashrate** della rete (disegnato via SVG, senza librerie esterne) con periodi
  selezionabili (1 mese / 3 mesi / 1 anno / 3 anni) e un tooltip interattivo al passaggio del mouse o del
  dito che mostra valore e data di ogni punto, countdown al prossimo aggiustamento della difficoltà, e un
  **countdown live al prossimo halving** (barra di progresso sull'epoca corrente, blocchi rimanenti,
  ricompensa attuale/futura nell'unità scelta BTC o sats) che si aggiorna da solo non appena arriva un
  nuovo blocco, senza ricaricare la pagina. Include anche i **pool di mining più attivi**, fino a 15 pool
  (in linea con la profondità mostrata su mempool.space/mining, non solo i primi 6) con periodo selezionabile
  (24h / 3 giorni / 1 settimana / 1 mese), una barra impilata colorata che mostra a colpo d'occhio la
  distribuzione tra pool, e la relativa percentuale ed efficienza nella selezione delle fee (quando il dato
  è disponibile) per ciascuno. Ogni sezione si carica in modo indipendente e ha un proprio pulsante "Riprova"
  se i dati non arrivano, così un problema su una singola fonte non blocca tutta la pagina. La card dei pool
  ricorda esplicitamente che le quote sono etichette rilevate da mempool.space (non un dato verificabile
  crittograficamente), che i miner possono cambiare pool in pochi minuti, e che nessun pool può da solo
  cambiare le regole del protocollo.
- **Dettaglio blocco**: informazioni principali in evidenza, dettagli tecnici avanzati (nonce, difficoltà,
  merkle root, ecc.) nascosti dietro un pannello a scomparsa, elenco transazioni con paginazione, e una
  **mappa visiva della composizione del blocco**: un mosaico di rettangoli (uno per transazione, dati reali
  scaricati al momento), con area proporzionale al peso e colore in base alla fee pagata — passa il mouse
  per i dettagli, clicca per aprire la transazione.
- **Verifica tu stesso il blocco** (nella pagina di dettaglio blocco): un pulsante che ricalcola *nel
  browser*, con la sola SHA-256 nativa e i dati già scaricati, se la merkle root dichiarata corrisponde
  davvero alle transazioni e se l'hash del blocco è una proof-of-work autentica — senza inviare nulla a
  nessun server. I due controlli sono indipendenti, per capire subito quale, se non torna.
- **Confronto con una seconda fonte indipendente** (blocco e transazione): un pulsante che rifà la stessa
  richiesta a blockstream.info e confronta campo per campo con la risposta di mempool.space, per non
  fidarsi ciecamente di un'unica fonte.
- **Dettaglio transazione**: stato (confermata / in attesa) con **tracker live delle conferme** — si
  aggiorna da solo ogni 15 secondi finché resti sulla pagina, senza mai ricaricarla — numero di conferme,
  spiegazione in parole semplici di chi ha inviato cosa a chi (con controvalore in EUR quando disponibile),
  elenco input/output. Per una transazione ancora **in attesa**, una card "Quanto potrei dover aspettare?"
  confronta la fee pagata con quelle consigliate in questo momento e dà un giudizio pratico (dal "dovrebbe
  confermarsi nel prossimo blocco" al "potrebbe restare in attesa a lungo", con un rimando a RBF e CPFP se
  la fee è molto bassa) — anche questa si aggiorna da sola col passare del tempo, perché la congestione
  della rete cambia.
- **Dettaglio indirizzo**: saldo attuale (con controvalore in EUR quando disponibile), totale ricevuto,
  cronologia transazioni con importi in entrata/uscita evidenziati, e un pulsante per **salvare l'indirizzo
  nei preferiti** (solo nel browser, nessun account necessario).
- **I tuoi indirizzi salvati** (in home, se ne hai salvato almeno uno): saldo aggiornato dei tuoi indirizzi
  preferiti senza doverli ripescare ogni volta dal wallet.
- **Verifica un indirizzo prima di inviare** (`#/guide/verifica-indirizzo`, dentro la sezione Guide):
  controlla il checksum (base58check o bech32/bech32m) di un indirizzo — legacy, P2SH, SegWit o Taproot —
  interamente nel browser, mostra l'indirizzo raggruppato a blocchi per un confronto manuale più facile, e
  segnala se ha già una cronologia on-chain. Conferma solo che l'indirizzo è scritto correttamente, non che
  appartenga a chi pensi: lo strumento lo ricorda esplicitamente.
- **Quanto costa inviare bitcoin adesso?** (in home): le fee consigliate del momento tradotte in sat e in
  euro (se il cambio è disponibile) per tre velocità diverse, su una transazione tipo.
- **Glossario** (`#/glossario`) con oltre 100 termini di Bitcoin spiegati in italiano semplice — dai
  fondamentali (blocco, fee, conferme) a protocollo e rete, indirizzi e chiavi, privacy e sicurezza,
  Lightning Network, crittografia di base e cultura Bitcoin — con una barra di ricerca che filtra la
  lista in tempo reale mentre scrivi. Ogni parola tecnica che compare nell'app è un link sottolineato
  che porta dritto alla voce corrispondente, evidenziata al volo.
- **Pulsanti "copia"** su hash, txid e indirizzi, per non dover selezionare a mano testi lunghi.
- **Grafica "liquid glass"**: pannelli traslucidi con effetto vetro smerigliato, sfondo a gradiente
  soffuso, forme arrotondate e tema chiaro/scuro automatico in base alle preferenze di sistema.
- **Guide** (`#/guide`) con approfondimenti pratici per chi inizia: come proteggere la seed phrase,
  custodial vs non-custodial, come scegliere il primo wallet, le truffe Bitcoin più comuni, come funzionano
  fee e conferme, e le basi della privacy su Bitcoin.
- **Primi passi con Bitcoin: la tua roadmap** (`#/guide/primi-passi`, in cima alla sezione Guide con badge
  "🚀 Inizia qui", e linkata anche in home): la guida pensata per chi ha appena comprato i suoi primi
  bitcoin e non sa da dove cominciare. Non insegna nulla di nuovo, ma mette in ordine consigliato le guide
  già esistenti — dal capire dove sono i propri fondi oggi, alla scelta del wallet, alla protezione della
  seed, al primo trasferimento con calma, fino a truffe da riconoscere e passi più avanzati (privacy, nodo
  proprio) da affrontare quando si è pronti.
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
- **Gestisci il tuo nodo** (`#/guide/gestisci-nodo`, dentro la sezione Guide): il passo successivo a un
  wallet non-custodial per chi vuole la sovranità completa — perché avere un proprio nodo Bitcoin conta,
  cosa cambia in termini di verifica e privacy, e da dove iniziare (Bitcoin Core, Umbrel, myNode, RaspiBlitz).
- **Banner di trasparenza permanente** in fondo a ogni pagina: ricorda che questo sito è un client di
  un'unica fonte terza (mempool.space), non un modo "trust-minimized" di verificare i dati, con link alla
  guida sul nodo.
- **Glossario ampliato** con SegWit, Taproot, PSBT, Multisig e Lightning Network, oltre ai ~25 termini di
  base — ogni indirizzo mostrato nell'app ha un prefisso (`1…`, `3…`, `bc1q…`, `bc1p…`) che ora è spiegato.
- **Novità** (`#/novita`, in header e in fondo pagina): il changelog del sito, versione dopo versione, per
  vedere in ogni momento cosa è cambiato di recente senza doverlo scoprire per caso.

### Come funziona

È un sito statico (HTML + CSS + JavaScript vanilla, nessuna build necessaria) che recupera i dati in
tempo reale dalle API pubbliche di [mempool.space](https://mempool.space), con un confronto opzionale
verso [blockstream.info](https://blockstream.info) per chi vuole un secondo parere. Non servono chiavi
API né un backend proprio: tutto (formattazione, calcoli di verifica, checksum degli indirizzi) gira nel
browser di chi visita il sito.

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
index.html          pagina principale (header, barra di ricerca, contenitore app)
css/styles.css       stile dell'interfaccia
js/api.js            chiamate alle API di mempool.space e al confronto con blockstream.info
js/format.js         funzioni di formattazione (date, importi, hash abbreviati, cambio EUR, ecc.)
js/app.js            router e logica delle varie viste (home, blocco, transazione, indirizzo, glossario, guide, mining)
js/watchlist.js       salvataggio locale degli indirizzi preferiti (localStorage)
js/addresscheck.js    verifica del checksum di un indirizzo (base58check, bech32/bech32m)
js/blockverify.js     ricalcolo client-side di merkle root e proof-of-work di un blocco
js/bip39.js           generazione della mnemonic BIP39 dai tiri di dado
js/bip39-wordlist.js  wordlist inglese ufficiale BIP39
js/treemap.js         algoritmo squarified treemap per la composizione del blocco
```
