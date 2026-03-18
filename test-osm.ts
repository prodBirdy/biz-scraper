import { scrapeOSM } from './server/scrapers/osm';

console.log('Testing new tile-based OSM scraper...\n');

const startTime = Date.now();

scrapeOSM('hausverwaltung', 'Berlin').then(results => {
  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n=== RESULTS ===`);
  console.log(`Found ${results.length} results in ${duration.toFixed(1)}s`);
  
  if (results.length > 0) {
    console.log('\nFirst 5 results:');
    results.slice(0, 5).forEach((r, i) => {
      console.log(`${i+1}. ${r.name}`);
      console.log(`   📍 ${r.address || 'N/A'}, ${r.zip || ''} ${r.city || ''}`);
      console.log(`   🏷️  ${r.category || 'N/A'}`);
    });
  }
  
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
