// Toy example: Not actually being invoked at any point in the application. 
// Illustrates old version of the transitions.


import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

const REFERENCE_STYLES = {
    P: { color: '#e377c2', label: 'Pronoun (P)' },
    N: { color: '#1f77b4', label: 'Nominal (N)' },
    PN: { color: '#2ca02c', label: 'Proper Noun (PN)' },
    Other: { color: '#d62728', label: 'Other' }
};

export function getTransitionStats(rawData, minMentionCount = 1) {
    const allChains = d3.group(rawData, d => `${d.conv_id}|${d.chain_id}`);
    const types = Object.keys(REFERENCE_STYLES).filter(k => k !== 'Other');
    const transitionMap = {};
    
    types.forEach(from => {
        transitionMap[from] = {};
        types.forEach(to => {
            transitionMap[from][to] = 0;
        });
    });

    allChains.forEach(mentions => {
        if (!mentions || mentions.length < minMentionCount) return;
        const sorted = mentions.slice().sort((a, b) => a.turn_id - b.turn_id);
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1].reference_type;
            const cur = sorted[i].reference_type;
            if (types.includes(prev) && types.includes(cur)) {
                transitionMap[prev][cur] += 1;
            }
        }
    });

    return transitionMap;
}

function formatSankeyData(transitionData) {
    const types = Object.keys(REFERENCE_STYLES).filter(k => k !== 'Other');
    const nodes = types.map(id => ({ id, name: REFERENCE_STYLES[id].label.split(' ')[0] }));
    const links = [];
    
    types.forEach(from => {
        types.forEach(to => {
            if (from !== to) {
                const count = transitionData[from][to] || 0;
                if (count > 0) {
                    links.push({ source: from, target: to, value: count });
                }
            }
        });
    });
    
    return { nodes, links };
}

export function renderTransitionSummary(transitionData) {
    const container = d3.select('#transition-summary-container');
    container.selectAll('*').remove();
    
    const types = Object.keys(REFERENCE_STYLES).filter(k => k !== 'Other');
    if (types.length === 0) return;

    const gridSize = 60;
    const padding = 4;
    const innerWidth = types.length * gridSize;
    const innerHeight = types.length * gridSize;
    const margin = { top: 40, left: 80, right: 10, bottom: 10 };
    const w = innerWidth + margin.left + margin.right;
    const h = innerHeight + margin.top + margin.bottom;

    let data = [];
    let maxCount = 0;
    
    types.forEach((from, i) => {
        types.forEach((to, j) => {
            const count = transitionData[from][to] || 0;
            maxCount = Math.max(maxCount, count);
            data.push({ from, to, count, x: j, y: i });
        });
    });

    const color = d3.scaleSequential(d3.interpolateBlues).domain([0, maxCount || 1]);
    const svg = container.append('svg')
        .attr('width', w)
        .attr('height', h)
        .style('background', '#fff')
        .style('border', '1px solid #ddd');
        
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    g.selectAll('rect')
        .data(data)
        .enter()
        .append('rect')
        .attr('x', d => d.x * gridSize)
        .attr('y', d => d.y * gridSize)
        .attr('width', gridSize - padding)
        .attr('height', gridSize - padding)
        .style('fill', d => d.count === 0 ? '#f0f0f0' : color(d.count))
        .style('stroke', '#ddd');

    g.selectAll('.count')
        .data(data.filter(d => d.count > 0))
        .enter()
        .append('text')
        .attr('x', d => d.x * gridSize + (gridSize - padding) / 2)
        .attr('y', d => d.y * gridSize + (gridSize - padding) / 2 + 4)
        .attr('text-anchor', 'middle')
        .style('font-weight', '700')
        .style('font-size', '12px')
        .text(d => d.count.toLocaleString());

    g.selectAll('.xlabel')
        .data(types)
        .enter()
        .append('text')
        .attr('x', (d, i) => i * gridSize + (gridSize - padding) / 2)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .style('font-weight', '700')
        .text(d => REFERENCE_STYLES[d].label.split(' ')[0]);

    g.selectAll('.ylabel')
        .data(types)
        .enter()
        .append('text')
        .attr('x', -10)
        .attr('y', (d, i) => i * gridSize + (gridSize - padding) / 2 + 4)
        .attr('text-anchor', 'end')
        .style('font-weight', '700')
        .text(d => REFERENCE_STYLES[d].label.split(' ')[0]);

    g.append('text')
        .attr('x', innerWidth / 2)
        .attr('y', -28)
        .attr('text-anchor', 'middle')
        .style('font-weight', '700')
        .text('Part-of-Speech Transition Counts');
}

export function renderTransitionGraph(transitionData) {
    const container = d3.select('#sankey-container');
    container.selectAll('*').remove();

    const margin = { top: 40, right: 20, bottom: 20, left: 20 };
    const width = 450;
    const height = 250;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = container.append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background', '#fff')
        .style('border', '1px solid #ddd');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const data = formatSankeyData(transitionData);
    const nodes = data.nodes.map(n => ({ ...n }));
    const links = data.links.map(l => ({ ...l }));

    // Fixed node positions: left (PN), center (N), right (P)
    const xMap = { PN: 0, N: innerW * 0.5, P: innerW };
    const cy = innerH * 0.5;
    const nodeRadius = 20;
    
    nodes.forEach(n => {
        n.x = xMap[n.id] ?? innerW * 0.5;
        n.y = cy;
    });

    // Assign offsets for reciprocal links (so they don't overlap)
    const reciprocalPairs = new Map();
    links.forEach(l => {
        const key = [l.source, l.target].sort().join('|');
        if (!reciprocalPairs.has(key)) reciprocalPairs.set(key, []);
        reciprocalPairs.get(key).push(l);
    });

    reciprocalPairs.forEach(list => {
        if (list.length === 2) {
            list[0].offset = 8;
            list[1].offset = -8;
        } else {
            list.forEach((l, idx) => {
                l.offset = (idx % 2 === 0 ? 8 : -8) * (1 + Math.floor(idx / 2));
            });
        }
    });

    const maxVal = d3.max(links, l => l.value) || 1;
    const widthScale = d3.scaleSqrt().domain([0, maxVal]).range([2, 14]);

    // Draw defs for arrowheads
    const defs = svg.append('defs');
    Object.keys(REFERENCE_STYLES).forEach(k => {
        defs.append('marker')
            .attr('id', `arrow-${k}`)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 12)
            .attr('refY', 5)
            .attr('markerUnits', 'strokeWidth')
            .attr('markerWidth', 8)
            .attr('markerHeight', 8)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0 0 L10 5 L0 10 z')
            .attr('fill', REFERENCE_STYLES[k].color);
    });

    // Draw links (white underlay + colored foreground + label)
    const linkGroup = g.append('g').attr('class', 'links');
    
    links.forEach(l => {
        const s = nodes.find(n => n.id === l.source);
        const t = nodes.find(n => n.id === l.target);
        if (!s || !t) return;

        const x1 = s.x;
        const x2 = t.x;
        const y1 = s.y + (l.offset || 0);
        const y2 = t.y + (l.offset || 0);

        const sw = widthScale(l.value);

        // White underlay for readability
        linkGroup.append('line')
            .attr('x1', x1)
            .attr('y1', y1)
            .attr('x2', x2)
            .attr('y2', y2)
            .attr('stroke', '#fff')
            .attr('stroke-width', sw + 6)
            .attr('stroke-linecap', 'round');

        // Colored foreground
        linkGroup.append('line')
            .attr('x1', x1)
            .attr('y1', y1)
            .attr('x2', x2)
            .attr('y2', y2)
            .attr('stroke', REFERENCE_STYLES[l.source].color)
            .attr('stroke-width', sw)
            .attr('stroke-linecap', 'round')
            .attr('marker-end', `url(#arrow-${l.source})`)
            .style('cursor', 'pointer')
            .on('mouseover', function () {
                d3.select(this).attr('stroke-width', sw + 3);
            })
            .on('mouseout', function () {
                d3.select(this).attr('stroke-width', sw);
            });

        // Count label with white halo
        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5 - 8;
        
        linkGroup.append('text')
            .attr('x', mx)
            .attr('y', my)
            .attr('text-anchor', 'middle')
            .style('font-size', '12px')
            .style('font-weight', '700')
            .style('stroke', '#fff')
            .style('stroke-width', 6)
            .style('paint-order', 'stroke')
            .style('fill', '#111')
            .text(l.value);
    });

    // Draw nodes
    const nodeGroup = g.append('g').attr('class', 'nodes');
    
    nodeGroup.selectAll('.node')
        .data(nodes)
        .enter()
        .append('circle')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', nodeRadius)
        .attr('fill', d => REFERENCE_STYLES[d.id].color)
        .attr('stroke', '#333')
        .attr('stroke-width', 1);

    nodeGroup.selectAll('.node-label')
        .data(nodes)
        .enter()
        .append('text')
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .style('fill', '#fff')
        .style('font-weight', '700')
        .style('font-size', '11px')
        .text(d => d.name);

    // Title
    g.append('text')
        .attr('x', innerW / 2)
        .attr('y', -15)
        .attr('text-anchor', 'middle')
        .style('font-weight', '700')
        .style('font-size', '13px')
        .text('Transition Graph (Weighted)');
}

export function drawGraph(rawData) {
    if (!rawData || rawData.length === 0) return;

    // Compute max mentions per chain for slider
    const allChains = d3.group(rawData, d => `${d.conv_id}|${d.chain_id}`);
    const maxChainCount = d3.max(Array.from(allChains.values(), v => v.length)) || 1;

    const slider = document.getElementById('chain-count-slider');
    const sliderValue = document.getElementById('slider-value');
    
    if (slider) {
        slider.min = 1;
        slider.max = Math.max(1, maxChainCount);
        slider.value = 1;
    }
    if (sliderValue) {
        sliderValue.textContent = String(slider ? slider.value : '1');
    }

    // Initial render
    const initialMin = slider ? +slider.value : 1;
    const transitions = getTransitionStats(rawData, initialMin);
    renderTransitionSummary(transitions);
    renderTransitionGraph(transitions);

    // Wire slider to re-render
    if (slider) {
        slider.addEventListener('input', (e) => {
            const v = +e.target.value;
            if (sliderValue) sliderValue.textContent = String(v);
            const t = getTransitionStats(rawData, v);
            renderTransitionSummary(t);
            renderTransitionGraph(t);
        });
    }

    window.updateConversation = (newConvId) => {
        // Placeholder for timeline updates (out of scope here)
    };
}
