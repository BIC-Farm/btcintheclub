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
- **Home page** con gli ultimi blocchi minati, transazioni in attesa (mempool) e fee consigliate,
  ciascuna con un piccolo tooltip "?" che spiega il termine.
- **Dettaglio blocco**: informazioni principali in evidenza, dettagli tecnici avanzati (nonce, difficoltà,
  merkle root, ecc.) nascosti dietro un pannello a scomparsa, elenco transazioni con paginazione.
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
