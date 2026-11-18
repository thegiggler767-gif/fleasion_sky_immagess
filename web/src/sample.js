// Built-in demo so the app shows something before a key is added.
const W = '#c9a46a', W2 = '#b98f57', SOIL = '#4a3526', LEAF = '#4f9a3c';
const parts = [];
// posts
for (const x of [-0.54, 0.54]) for (const z of [-0.24, 0.24]) parts.push({ name: 'Corner post', shape: 'box', size: [0.07, 0.4, 0.07], pos: [x, 0.2, z], rot: [0, 0, 0], color: W2, material: 'wood', item: 's2', step: 1 });
// long boards
for (const z of [-0.2875, 0.2875]) for (const y of [0.1, 0.3]) parts.push({ name: 'Long side board', shape: 'box', size: [1.2, 0.195, 0.025], pos: [0, y, z], rot: [0, 0, 0], color: W, material: 'wood', item: 's1', step: 2 });
// short boards
for (const x of [-0.5875, 0.5875]) for (const y of [0.1, 0.3]) parts.push({ name: 'End board', shape: 'box', size: [0.025, 0.195, 0.55], pos: [x, y, 0], rot: [0, 0, 0], color: W, material: 'wood', item: 's1', step: 3 });
parts.push({ name: 'Liner', shape: 'box', size: [1.12, 0.005, 0.52], pos: [0, 0.003, 0], rot: [0, 0, 0], color: '#222222', material: 'fabric', item: 's4', step: 4 });
parts.push({ name: 'Garden soil', shape: 'box', size: [1.12, 0.33, 0.52], pos: [0, 0.17, 0], rot: [0, 0, 0], color: SOIL, material: 'soil', item: 's5', step: 5 });
[[-0.38, -0.12], [-0.12, 0.12], [0.14, -0.1], [0.38, 0.12]].forEach(([x, z], i) => {
  parts.push({ name: 'Seedling', shape: 'sphere', size: [0.16, 0.13, 0.16], pos: [x, 0.39, z], rot: [0, 0, 0], color: i % 2 ? LEAF : '#6bb84a', material: 'plant', item: 's6', step: 6 });
  parts.push({ name: 'Stem', shape: 'cylinder', size: [0.012, 0.05, 0.012], pos: [x, 0.355, z], rot: [0, 0, 0], color: '#3d6b2a', material: 'plant', item: 's6', step: 6 });
});

export const SAMPLE = {
  type: 'project',
  title: 'Raised Garden Bed (demo)',
  summary: 'A simple 1.2 m treated-pine raised garden bed — this demo works without an API key. Add your OpenRouter key in Settings to make your own.',
  difficulty: 'easy',
  time_estimate: '2–3 hours',
  dimensions: '1200 × 600 × 400 mm',
  tools: ['Drill/driver', 'Handsaw or circular saw', 'Tape measure', 'Square', 'Staple gun'],
  tips: ['Use H4 treated pine or a naturally durable hardwood for ground contact.', 'Pre-drill near board ends to stop splitting.'],
  shopping_list: [
    { id: 's1', name: 'Treated pine sleeper 200 × 25 mm, 2.4 m', qty: 3, unit: 'lengths', price: 54, category: 'Timber', notes: 'Cut into 4 × 1200 mm sides and 4 × 550 mm ends', optional: false },
    { id: 's2', name: 'Treated pine post 70 × 70 mm, 1.8 m', qty: 1, unit: 'length', price: 22, category: 'Timber', notes: 'Cut into 4 × 400 mm corner posts', optional: false },
    { id: 's3', name: 'Galvanised batten screws 65 mm', qty: 1, unit: 'pack', price: 14, category: 'Hardware', notes: '~32 screws needed', optional: false },
    { id: 's4', name: 'Weed mat / geotextile 2 m', qty: 1, unit: 'roll', price: 12, category: 'Garden', notes: 'Lines the bottom, keeps weeds out', optional: false },
    { id: 's5', name: 'Vegetable garden soil mix 25 L', qty: 8, unit: 'bags', price: 68, category: 'Garden', notes: 'About 200 L to fill', optional: false },
    { id: 's6', name: 'Vegie seedlings punnet', qty: 2, unit: 'punnets', price: 9, category: 'Garden', notes: 'Lettuce, herbs, etc.', optional: true },
  ],
  steps: [
    { title: 'Cut the timber', detail: 'Cut the post into four 400 mm corner posts. Cut the sleepers into four 1200 mm sides and four 550 mm ends.' },
    { title: 'Build the long sides', detail: 'Screw two long boards to a pair of posts, flush at the top. Repeat for the other side.' },
    { title: 'Add the ends', detail: 'Stand the two sides up and screw the end boards into the posts to make a box. Check it is square.' },
    { title: 'Lay the liner', detail: 'Place the bed in a sunny spot and lay weed mat inside the base.' },
    { title: 'Fill with soil', detail: 'Fill with garden soil mix to about 40 mm below the top and water it in.' },
    { title: 'Plant it out', detail: 'Plant your seedlings, water well and mulch around them.' },
  ],
  model: { parts },
  generatedBy: 'demo',
};
