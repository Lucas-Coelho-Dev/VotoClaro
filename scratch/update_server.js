const fs = require('fs');

const FILE_PATH = 'server.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

// 1. Add fotoUrl and correct IDs in LOCAL_CANDIDATES
const replacements = [
  {
    target: 'nome: "Luiz Inácio Lula da Silva",',
    replacement: 'nome: "Luiz Inácio Lula da Silva",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/280001607229/BR",'
  },
  {
    target: 'nome: "Tarcísio Gomes de Freitas",',
    replacement: 'nome: "Tarcísio Gomes de Freitas",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/250001614720/SP",'
  },
  {
    target: 'nome: "Ciro Ferreira Gomes",',
    replacement: 'nome: "Ciro Ferreira Gomes",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/280001607246/BR",'
  },
  {
    target: 'nome: "Flávio Nantes Bolsonaro",',
    replacement: 'nome: "Flávio Nantes Bolsonaro",\n    fotoUrl: "https://www.senado.leg.br/senadores/img/fotos-oficial/senador5894.jpg",'
  },
  {
    target: 'nome: "Simone Nassar Tebet",',
    replacement: 'nome: "Simone Nassar Tebet",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/280001607833/BR",'
  },
  {
    target: 'nome: "Ronaldo Ramos Caiado",',
    replacement: 'nome: "Ronaldo Ramos Caiado",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/90001605389/GO",'
  },
  {
    target: 'nome: "Eduardo da Costa Paes",',
    replacement: 'nome: "Eduardo da Costa Paes",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2045202024/190001972132/RJ",'
  },
  {
    target: 'nome: "Cláudio Bomfim de Castro e Silva",',
    replacement: 'nome: "Cláudio Bomfim de Castro e Silva",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001610444/RJ",'
  },
  {
    target: 'nome: "Marcelo Ribeiro Freixo",',
    replacement: 'nome: "Marcelo Ribeiro Freixo",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001600371/RJ",'
  },
  {
    target: 'nome: "Rodrigo da Silva Neves",',
    replacement: 'nome: "Rodrigo da Silva Neves",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001606887/RJ",'
  },
  {
    target: `nome: "Romário de Souza Faria",
    urna: "ROMÁRIO",
    partido: "PL",
    numero: 222,
    cargo: "Senador",
    uf: "RJ",
    situacao: "deferida",
    cor: "#0B2A4A",
    idade: 60,
    coligacao: "PL, PP, Republicanos",
    naturalidade: "Rio de Janeiro / RJ",
    camaraId: 160589,
    senadoId: 5979,`,
    replacement: `nome: "Romário de Souza Faria",
    urna: "ROMÁRIO",
    partido: "PL",
    numero: 222,
    cargo: "Senador",
    uf: "RJ",
    situacao: "deferida",
    cor: "#0B2A4A",
    idade: 60,
    coligacao: "PL, PP, Republicanos",
    naturalidade: "Rio de Janeiro / RJ",
    camaraId: 160589,
    senadoId: 5322,
    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001608479/RJ",`
  },
  {
    target: 'nome: "Alessandro Lucciola Molon",',
    replacement: 'nome: "Alessandro Lucciola Molon",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001603598/RJ",'
  },
  {
    target: 'nome: "Benedita Souza da Silva Sampaio",',
    replacement: 'nome: "Benedita Souza da Silva Sampaio",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001600412/RJ",'
  },
  {
    target: `nome: "Tarcísio Motta de Carvalho",
    urna: "TARCÍSIO MOTTA",
    partido: "PSOL",
    numero: 5050,
    cargo: "Deputado Federal",
    uf: "RJ",
    situacao: "deferida",
    cor: "#8C1919",
    idade: 51,
    coligacao: "Federação PSOL REDE",
    naturalidade: "Petrópolis / RJ",
    camaraId: 220556,`,
    replacement: `nome: "Tarcísio Motta de Carvalho",
    urna: "TARCÍSIO MOTTA",
    partido: "PSOL",
    numero: 5050,
    cargo: "Deputado Federal",
    uf: "RJ",
    situacao: "deferida",
    cor: "#8C1919",
    idade: 51,
    coligacao: "Federação PSOL REDE",
    naturalidade: "Petrópolis / RJ",
    camaraId: 220598,
    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001600392/RJ",`
  },
  {
    target: `nome: "Lindbergh Farias Filho",
    urna: "LINDBERGH FARIAS",
    partido: "PT",
    numero: 1313,
    cargo: "Deputado Federal",
    uf: "RJ",
    situacao: "deferida",
    cor: "#A31919",
    idade: 56,
    coligacao: "Federação Brasil da Esperança (PT, PCdoB, PV)",
    naturalidade: "João Pessoa / PB",
    camaraId: 121086,`,
    replacement: `nome: "Lindbergh Farias Filho",
    urna: "LINDBERGH FARIAS",
    partido: "PT",
    numero: 1313,
    cargo: "Deputado Federal",
    uf: "RJ",
    situacao: "deferida",
    cor: "#A31919",
    idade: 56,
    coligacao: "Federação Brasil da Esperança (PT, PCdoB, PV)",
    naturalidade: "João Pessoa / PB",
    camaraId: 74858,
    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001600416/RJ",`
  },
  {
    target: 'nome: "Martha Rocha",',
    replacement: 'nome: "Martha Rocha",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001654227/RJ",'
  },
  {
    target: 'nome: "Rodrigo Pires Amorim",',
    replacement: 'nome: "Rodrigo Pires Amorim",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001603223/RJ",'
  },
  {
    target: 'nome: "Renata da Silva Souza",',
    replacement: 'nome: "Renata da Silva Souza",\n    fotoUrl: "https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/2040602022/190001600421/RJ",'
  }
];

replacements.forEach(({ target, replacement }) => {
  // Normalize target and replace it
  const targetClean = target.replace(/\r\n/g, '\n');
  const replacementClean = replacement.replace(/\r\n/g, '\n');
  
  if (code.includes(targetClean)) {
    code = code.replace(targetClean, replacementClean);
    console.log(`Replaced successfully: ${targetClean.split('\n')[0]}`);
  } else {
    // Try with normalized windows newlines
    const targetWin = target.replace(/\n/g, '\r\n');
    const replacementWin = replacement.replace(/\n/g, '\r\n');
    if (code.includes(targetWin)) {
      code = code.replace(targetWin, replacementWin);
      console.log(`Replaced successfully (win): ${targetClean.split('\n')[0]}`);
    } else {
      console.warn(`WARNING: target not found: ${targetClean.split('\n')[0]}`);
    }
  }
});

// 2. Update parseSenators photoUrl mapping (http -> https)
const photoTarget = 'fotoUrl: p.UrlFotoParlamentar,';
const photoReplacement = "fotoUrl: p.UrlFotoParlamentar ? p.UrlFotoParlamentar.replace(/^http:\\/\\//i, 'https://') : null,";

if (code.includes(photoTarget)) {
  code = code.replace(photoTarget, photoReplacement);
  console.log('Replaced parseSenators photoUrl mapping successfully.');
} else {
  console.warn('WARNING: parseSenators photoUrl mapping not found!');
}

// 3. Update candidates API and cleanName definition
const apiTarget = `app.get('/api/candidates', (req, res) => {
  const localCamaraIds = LOCAL_CANDIDATES.map(c => c.camaraId).filter(id => id !== null && id !== undefined);
  const localSenadoIds = LOCAL_CANDIDATES.map(c => c.senadoId).filter(id => id !== null && id !== undefined);
  const localTseIds = LOCAL_CANDIDATES.map(c => c.tseId).filter(id => id !== null && id !== undefined);

  const filteredDeputies = cachedDeputies.filter(d => {
    return !localCamaraIds.some(id => String(id) === String(d.camaraId));
  });

  const filteredSenators = cachedSenators.filter(s => {
    return !localSenadoIds.some(id => String(id) === String(s.senadoId));
  });

  const filteredStateDeputies = cachedStateDeputies.filter(sd => {
    return !localTseIds.some(id => String(id) === String(sd.tseId));
  });

  const allCandidates = [
    ...LOCAL_CANDIDATES,
    ...filteredDeputies,
    ...filteredSenators,
    ...filteredStateDeputies
  ];
  
  res.json({
    candidates: allCandidates,
    status: {
      deputiesLoaded: isDeputiesLoaded,
      senatorsLoaded: isSenatorsLoaded,
      stateDeputiesLoaded: isStateDeputiesLoaded,
      errors: loadErrors,
      counts: {
        total: allCandidates.length,
        local: LOCAL_CANDIDATES.length,
        deputies: filteredDeputies.length,
        senators: filteredSenators.length,
        stateDeputies: filteredStateDeputies.length
      }
    }
  });
});`;

const apiReplacement = `function cleanName(name) {
  if (!name) return '';
  return name.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

app.get('/api/candidates', (req, res) => {
  const localCamaraIds = LOCAL_CANDIDATES.map(c => c.camaraId).filter(id => id !== null && id !== undefined);
  const localSenadoIds = LOCAL_CANDIDATES.map(c => c.senadoId).filter(id => id !== null && id !== undefined);
  const localTseIds = LOCAL_CANDIDATES.map(c => c.tseId).filter(id => id !== null && id !== undefined);

  const filteredDeputies = cachedDeputies.filter(d => {
    const isDuplicateId = localCamaraIds.some(id => String(id) === String(d.camaraId));
    if (isDuplicateId) return false;
    
    const cleanDName = cleanName(d.nome);
    const cleanDUrna = cleanName(d.urna);
    const isDuplicateName = LOCAL_CANDIDATES.some(lc => {
      if (lc.cargo !== d.cargo) return false;
      const cleanLcName = cleanName(lc.nome);
      const cleanLcUrna = cleanName(lc.urna);
      return cleanLcName === cleanDName || cleanLcUrna === cleanDUrna || cleanLcName.startsWith(cleanDUrna) || cleanLcUrna.startsWith(cleanDName);
    });
    return !isDuplicateName;
  });

  const filteredSenators = cachedSenators.filter(s => {
    const isDuplicateId = localSenadoIds.some(id => String(id) === String(s.senadoId));
    if (isDuplicateId) return false;
    
    const cleanSName = cleanName(s.nome);
    const cleanSUrna = cleanName(s.urna);
    const isDuplicateName = LOCAL_CANDIDATES.some(lc => {
      if (lc.cargo !== s.cargo) return false;
      const cleanLcName = cleanName(lc.nome);
      const cleanLcUrna = cleanName(lc.urna);
      return cleanLcName === cleanSName || cleanLcUrna === cleanSUrna || cleanLcName.startsWith(cleanSUrna) || cleanLcUrna.startsWith(cleanSName);
    });
    return !isDuplicateName;
  });

  const filteredStateDeputies = cachedStateDeputies.filter(sd => {
    const isDuplicateId = localTseIds.some(id => String(id) === String(sd.tseId));
    if (isDuplicateId) return false;
    
    const cleanSdName = cleanName(sd.nome);
    const cleanSdUrna = cleanName(sd.urna);
    const isDuplicateName = LOCAL_CANDIDATES.some(lc => {
      if (lc.cargo !== sd.cargo) return false;
      const cleanLcName = cleanName(lc.nome);
      const cleanLcUrna = cleanName(lc.urna);
      return cleanLcName === cleanSdName || cleanLcUrna === cleanSdUrna || cleanLcName.startsWith(cleanSdUrna) || cleanLcUrna.startsWith(cleanSdName);
    });
    return !isDuplicateName;
  });

  const allCandidates = [
    ...LOCAL_CANDIDATES,
    ...filteredDeputies,
    ...filteredSenators,
    ...filteredStateDeputies
  ];
  
  res.json({
    candidates: allCandidates,
    status: {
      deputiesLoaded: isDeputiesLoaded,
      senatorsLoaded: isSenatorsLoaded,
      stateDeputiesLoaded: isStateDeputiesLoaded,
      errors: loadErrors,
      counts: {
        total: allCandidates.length,
        local: LOCAL_CANDIDATES.length,
        deputies: filteredDeputies.length,
        senators: filteredSenators.length,
        stateDeputies: filteredStateDeputies.length
      }
    }
  });
});`;

// Clean windows newlines before comparing API block
const apiTargetClean = apiTarget.replace(/\r\n/g, '\n');
const apiReplacementClean = apiReplacement.replace(/\r\n/g, '\n');

if (code.replace(/\r\n/g, '\n').includes(apiTargetClean)) {
  // Let's do the replace on code by matching normalized versions
  const codeClean = code.replace(/\r\n/g, '\n');
  const index = codeClean.indexOf(apiTargetClean);
  const partBefore = codeClean.substring(0, index);
  const partAfter = codeClean.substring(index + apiTargetClean.length);
  code = partBefore + apiReplacementClean + partAfter;
  console.log('Replaced candidates API endpoint successfully.');
} else {
  console.warn('WARNING: candidates API endpoint not found!');
}

fs.writeFileSync(FILE_PATH, code, 'utf8');
console.log('Done modifying server.js!');
