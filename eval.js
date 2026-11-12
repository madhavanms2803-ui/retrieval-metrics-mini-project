// Evaluate keyword and semantic retrieval using MRR and Recall@10.
// Run with: node eval.js
// No external packages are required.

const fs = require('node:fs');
const path = require('node:path');

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  fields.push(value);
  return fields;
}

// Load the gold-standard test set. correct_post_ids can contain multiple
// relevant post IDs separated by semicolons.
function loadTestSet(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(line => line.length > 0);

  return lines.slice(1).map((line, index) => {
    const [query, ids] = parseCsvLine(line);
    if (!query || !ids) {
      throw new Error(`Invalid test-set.csv row at line ${index + 2}`);
    }

    const correctIds = ids.split(';').map(id => Number(id.trim()));
    if (correctIds.some(id => !Number.isInteger(id))) {
      throw new Error(`Invalid correct_post_ids at line ${index + 2}`);
    }

    return { query, correctIds };
  });
}

const testSet = loadTestSet(path.join(__dirname, 'test-set.csv'));
const results = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'search-results.json'), 'utf8')
);

// Return the 1-based rank of the first relevant result, or null for a miss.
function rankOf(rankedIds, correctIds) {
  const relevantIds = new Set(correctIds.map(Number));

  for (let index = 0; index < rankedIds.length; index++) {
    if (relevantIds.has(Number(rankedIds[index]))) {
      return index + 1;
    }
  }

  return null;
}

// Reciprocal Rank rewards relevant results that appear near the top.
function reciprocalRank(rankedIds, correctIds) {
  const rank = rankOf(rankedIds, correctIds);
  return rank === null ? 0 : 1 / rank;
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

const keywordRRs = [];
const semanticRRs = [];
let keywordHits = 0;
let semanticHits = 0;
const rows = [];

for (const { query, correctIds } of testSet) {
  const queryResults = results[query];

  if (!queryResults) {
    throw new Error(`Missing search results for query: "${query}"`);
  }

  const keywordIds = Array.isArray(queryResults.keyword)
    ? queryResults.keyword
    : [];
  const semanticIds = Array.isArray(queryResults.semantic)
    ? queryResults.semantic
    : [];

  const keywordRank = rankOf(keywordIds, correctIds);
  const semanticRank = rankOf(semanticIds, correctIds);

  const keywordRR = reciprocalRank(keywordIds, correctIds);
  const semanticRR = reciprocalRank(semanticIds, correctIds);

  keywordRRs.push(keywordRR);
  semanticRRs.push(semanticRR);

  if (keywordRR > 0) keywordHits++;
  if (semanticRR > 0) semanticHits++;

  rows.push({
    query,
    keywordRank: keywordRank === null ? 'miss' : String(keywordRank),
    semanticRank: semanticRank === null ? 'miss' : String(semanticRank),
  });
}

const keywordMRR = mean(keywordRRs);
const semanticMRR = mean(semanticRRs);
const keywordRecall = testSet.length === 0 ? 0 : keywordHits / testSet.length;
const semanticRecall = testSet.length === 0 ? 0 : semanticHits / testSet.length;

// Print the per-query ranks and the aggregate metrics as a Markdown table.
const table = [
  '| Query | Keyword rank | Semantic rank |',
  '|---|---|---|',
  ...rows.map(row =>
    `| ${row.query} | ${row.keywordRank} | ${row.semanticRank} |`
  ),
  `| **Summary** | **MRR ${keywordMRR.toFixed(2)} · Recall@10 ${keywordRecall.toFixed(2)}** | **MRR ${semanticMRR.toFixed(2)} · Recall@10 ${semanticRecall.toFixed(2)}** |`,
];

console.log(table.join('\n'));
