async function runKbTests() {
  console.log('=== 2. TESTING KNOWLEDGE BASE MANAGEMENT ===');
  const BASE = 'http://localhost:5000/api';

  // Login as admin
  const adminRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@kaira', password: 'kaira@123' })
  });
  const { token } = await adminRes.json();

  // 1. Add Knowledge Entry
  const addRes = await fetch(`${BASE}/knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Automated Test Warranty Policy',
      category: 'policies',
      question: 'What is the warranty period for KAIRA hardware?',
      answer: 'KAIRA voice hardware comes with a standard 3-year replacement warranty covering all manufacturing defects.',
      content: 'Standard 3-year replacement warranty on all voice gateway devices and microphones.',
      keywords: 'warranty, hardware, replacement, 3-year'
    })
  });
  const addData = await addRes.json();
  console.log('Admin add knowledge entry:', addRes.ok && addData.entry.id ? 'PASS ✓' : 'FAIL ✗');

  const entryId = addData.entry.id;

  // 2. Search Knowledge
  const searchRes = await fetch(`${BASE}/knowledge?search=warranty`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const searchData = await searchRes.json();
  const found = searchData.entries.some((e: any) => e.id === entryId);
  console.log('Search knowledge entries:', found ? 'PASS ✓' : 'FAIL ✗');

  // 3. Edit Knowledge Entry
  const editRes = await fetch(`${BASE}/knowledge/${entryId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Automated Test Warranty Policy (Updated)',
      category: 'policies',
      answer: 'KAIRA voice hardware comes with a 5-year extended warranty.'
    })
  });
  const editData = await editRes.json();
  console.log('Admin edit knowledge entry:', editRes.ok && editData.entry.title.includes('Updated') ? 'PASS ✓' : 'FAIL ✗');

  // 4. Delete Knowledge Entry
  const delRes = await fetch(`${BASE}/knowledge/${entryId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Admin delete knowledge entry:', delRes.ok ? 'PASS ✓' : 'FAIL ✗');

  // 5. Verify removal from retrieval
  const verifyRes = await fetch(`${BASE}/knowledge?search=warranty`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const verifyData = await verifyRes.json();
  const stillFound = verifyData.entries.some((e: any) => e.id === entryId);
  console.log('Deleted entry removed from search index:', !stillFound ? 'PASS ✓' : 'FAIL ✗');

  process.exit(0);
}

runKbTests();
