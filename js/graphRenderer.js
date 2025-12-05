import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// config
const margin = {top: 30, right: 30, bottom: 50, left: 100};
const heightPerChain = 12; 
const PIXELS_PER_TURN = 12; 
const LINE_THICKNESS = 8;
const SALIENCE_DECAY_RATE = 0.30; // Controls how fast salience fades per turn
const SALIENCE_THRESHOLD = 0.65; // count mentions iff salience is above this threshold

const LEGEND_Y_OFFSET = -20; 
const LEGEND_ITEM_SPACING = 120; 

// reference types
const SALIENCE_MAP = { "P": 3, "N": 2, "PN": 1 };
const REFERENCE_STYLES = {
    "P": { color: "#e377c2", label: "Pronoun (P)" },
    "N": { color: "#1f77b4", label: "Nominal (N)" },
    "PN": { color: "#2ca02c", label: "Proper Noun (PN)" },
    "End": { color: "#ffffff", label: "Dissipation" }, 
    "Other": { color: "#d62728", label: "Other" }
};

// TODO: Delete this, it's no longer being used.
// speakers
const SPEAKER_STYLES = {
    "S1": { color: "#ffffff", label: "" }, // Orange
    "S2": { color: "#ffffff", label: "" }  // Purple
};

let svg;
let g;

// Scales
const xScale = d3.scaleLinear();

// convert raw data for time series
/**
 * Processes raw coreference chain data to create timeline segments (bands)
 * and individual mention markers, tracking speaker for markers and reference type for segments.
 * @param {Array} rawData - The full array of mention objects.
 * @param {number} selectedConvId - The conversation ID to analyze.
 */
function getTimelineData(rawData, selectedConvId) {
    const convData = rawData.filter(d => d.conv_id === selectedConvId);
    
    // mentions by Chain ID
    const chains = d3.group(convData, d => d.chain_id);
    const maxTurnId = d3.max(convData, d => d.turn_id) || 0;
    
    let segmentData = []; // single-turn segments (bands)
    let mentionData = [];

    chains.forEach((mentions, chainId) => {
        const sortedMentions = mentions.sort((a, b) => a.turn_id - b.turn_id);
        
        let lastMentionTurn = sortedMentions[0].turn_id;
        let lastMentionType = sortedMentions[0].reference_type;
        const chainLabel = sortedMentions[0].text || `Chain ${chainId}`;

        /**
         * Generates decay between two points exponentially.
         */
        const generateDecaySegments = (startTurn, endTurn, refType) => {
            for (let t = startTurn; t <= endTurn; t++) {
                // number of turns after the mention at lastMentionTurn = distnace
                const turnsSinceMention = t - lastMentionTurn;
                
                // Exponential decay
                const opacity = Math.exp(-SALIENCE_DECAY_RATE * turnsSinceMention);
                
                segmentData.push({
                    chain_id: chainId,
                    start_turn: t,
                    end_turn: t, 
                    reference_type: refType,
                    // Cap opacity to ensure a minimum visible trace
                    opacity: Math.max(0.05, Math.min(1.0, opacity)) 
                });
            }
        };

        // Iterate through mentions to generate segments between them
        for (let i = 0; i < sortedMentions.length; i++) {
            const currentMention = sortedMentions[i];

            if (i > 0) {
                // Generate decay segments for the gap between the last mention and this one
                if (lastMentionTurn + 1 <= currentMention.turn_id - 1) {
                    generateDecaySegments(lastMentionTurn + 1, currentMention.turn_id - 1, lastMentionType);
                }
            }
            
            // Add the segment for turn of the current mention
            // This also handles first mention
            segmentData.push({
                chain_id: chainId,
                start_turn: currentMention.turn_id,
                end_turn: currentMention.turn_id,
                reference_type: currentMention.reference_type,
                opacity: 1.0,
            });

            // Store the current mention for the marker
            mentionData.push({
                turn_id: currentMention.turn_id,
                chain_id: chainId,
                reference_type: currentMention.reference_type,
                speaker: currentMention.speaker, 
                mention_text: currentMention.text
            });

            // Update state for the next loop
            lastMentionTurn = currentMention.turn_id;
            lastMentionType = currentMention.reference_type;
        }

        // Store the final segment (from the last mention turn + 1 up to maxTurnId)
        // Creates the desired decay at the end of the timeline
        if (lastMentionTurn < maxTurnId) {
            generateDecaySegments(lastMentionTurn + 1, maxTurnId, lastMentionType);
        }
    });

    // Get unique chains for Y-Axis sorting and labels
    const uniqueChains = Array.from(d3.group(convData, d => d.chain_id), ([key, value]) => ({
        // Ensure chain_id is treated as a number for reliable sorting
        chain_id: +key, 
        min_turn: d3.min(value, d => d.turn_id),
        label: value.sort((a, b) => a.turn_id - b.turn_id)[0].text || `Chain ${key}`
    }));
    // Sort chains by their first mention turn (and chain_id for stability)
    uniqueChains.sort((a, b) => {
        if (a.min_turn !== b.min_turn) {
            return a.min_turn - b.min_turn;
        }
        // If min_turn is equal, sort by chain_id to ensure stable order
        return a.chain_id - b.chain_id; 
    });
    
    uniqueChains.forEach((d, i) => d.y_index = i);

    const chainYMap = new Map(uniqueChains.map(d => [d.chain_id, d.y_index]));
    
    // apply Y to segments and mentions
    segmentData.forEach(d => d.y_index = chainYMap.get(d.chain_id));
    mentionData.forEach(d => d.y_index = chainYMap.get(d.chain_id));

    // Filter segments that are valid (shouldn't be necessary with the new loop, but harmless)
    return { 
        chainData: segmentData.filter(d => d.start_turn <= d.end_turn), 
        mentionData, 
        maxTurnId, 
        totalChains: uniqueChains.length, 
        uniqueChains 
    };
}

/**
 * Calculates the total count of transitions between reference types (PN, N, P)
 * across ALL coreference chains in the entire dataset.
 *
 * @param {Array} rawData - The full array of mention objects (all conversations).
 * @returns {Object} A nested object/matrix of transition counts (e.g., { 'PN': { 'N': 5, 'P': 2, ... } })
 * 
 * 
 * This function was created with the support of Github Copilot.
 */
function getTransitionStats(rawData, minMentionCount = 1) {
    // Group data by coreference chain ID across all conversations.
    // Use a composite key of conversation + chain so chains from different 
    // conversations are not accidentally merged
    const allChains = d3.group(rawData, d => `${d.conv_id}|${d.chain_id}`);
    
    // Use only the primary reference types (not dissipation!)
    const allTypes = Object.keys(REFERENCE_STYLES).filter(k => k !== 'Other'); 
    
    // Define primary types for rows
    const primaryTypes = allTypes.filter(k => k !== 'End'); 
    const transitionMap = {};
    
    
    // init the transition matrix with all 0s
    primaryTypes.forEach(from => { 
        transitionMap[from] = {};
        allTypes.forEach(to => {
            transitionMap[from][to] = 0;
        });
    });

    allChains.forEach(mentions => {
        if ((mentions || []).length < minMentionCount) return;
        const sortedMentions = mentions.sort((a, b) => a.turn_id - b.turn_id);
        
        // transitions for this chain
        for (let i = 1; i < sortedMentions.length; i++) {
            let prevType = sortedMentions[i - 1].reference_type;
            let currentType = sortedMentions[i].reference_type;

            if (primaryTypes.includes(prevType) && primaryTypes.includes(currentType)) {
                 transitionMap[prevType][currentType] += 1;
            }
        }
        
        // add transition to 'End'
        const lastMention = sortedMentions[sortedMentions.length - 1];
        let lastType = lastMention.reference_type;

        if (primaryTypes.includes(lastType)) {
            transitionMap[lastType]["End"] += 1;
        }
    });

    return transitionMap;
}

/**
 * Converts the transition matrix into the nodes and links format required by D3 Sankey.
 * Filters out self-loops (links where source == target) and breaks reciprocal cycles (A <-> B) 
 * by keeping only the stronger link.
 * @param {Object} transitionData - The nested object/matrix of transition counts.
 * @returns {Object} { nodes, links }
 * 
 * Initially, this was a Sankey diagram, but d3's Sankey support was not suitable for 
 * these purposes and was replaced with a directed graph. The name of the function call,
 * however, remains for continuity.
 */
function formatSankeyData(transitionData) {

    const types = Object.keys(REFERENCE_STYLES).filter(k => k !== 'Other'); 
    const primaryTypes = types.filter(k => k !== 'End'); 
    
    // Nodes now includes End
    const nodes = types.map(id => ({ 
        id: id, 
        name: REFERENCE_STYLES[id].label.split(' ')[0] 
    }));
    
    const links = [];
    primaryTypes.forEach(fromType => {
        types.forEach(toType => { 
            if (fromType !== toType) {
                const count = transitionData[fromType][toType] || 0;
                if (count > 0) {
                    links.push({ source: fromType, target: toType, value: count });
                }
            }
        });
    });

    return { nodes, links };
}

/**
 * Renders a D3 heatmap visualizing the transition counts between reference types.
 * This assumes an HTML container with ID #transition-summary-container exists.
 * @param {Object} transitionData - The nested object/matrix of transition counts.
 * 
 * This function was created with the support of Github Copilot.
 */
function renderTransitionSummary(transitionData) {
    const container = d3.select("#transition-summary-container");

    // clear
    container.selectAll("*").remove();

    const allTypes = Object.keys(REFERENCE_STYLES).filter(k => k !== 'Other');
    
    // Define primary types
    const primaryTypes = allTypes.filter(k => k !== 'End'); 
    
    if (primaryTypes.length === 0) return;

    const numColumns = allTypes.length;    
    const numRows = primaryTypes.length; 

    // Define target dimensions 
    const targetWidth = 450;
    const targetHeight = 533; 
    
    // Define margin
    const margin = {top: 50, right: 10, bottom: 50, left: 100}; 

    // Calculate inner dimensions
    const innerWidth = targetWidth - margin.left - margin.right;
    const innerHeight = targetHeight - margin.top - margin.bottom;

    // Calculate cell sizes
    const cellWidth = innerWidth / numColumns;
    const cellHeight = innerHeight / numRows;

    const padding = 2; 

    // Total width/height set to target size for the SVG
    const totalWidth = targetWidth; 
    const totalHeight = targetHeight; 
    

    let data = [];
    let maxCount = 0;
    let totalTransitions = 0;

    // rows: Only iterates over 'PN', 'N', 'P'
    primaryTypes.forEach((fromType, i) => {
        // cols: iterates over 'PN', 'N', 'P', 'End' for columns 
        allTypes.forEach((toType, j) => { 
            const count = transitionData[fromType][toType] || 0; 
            
            maxCount = Math.max(maxCount, count);
            totalTransitions += count; 

            // push data point to the array
            data.push({ 
                from: fromType, 
                to: toType, 
                count: count,
                x: j, 
                y: i  
            });
        });
    });

    data.forEach(d => {
        d.percentage = totalTransitions > 0 ? (d.count / totalTransitions) : 0;
    });

    const colorScale = d3.scaleSequential(d3.interpolateBlues)
        .domain([0, maxCount]);

    const svgSummary = container.append("svg")
        .attr("width", totalWidth)
        .attr("height", totalHeight)
        .style("background-color", "#fff")
        .style("border", "1px solid #ddd")
        .style("border-radius", "8px")
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);
        
    //  Heatmap Cells 
    svgSummary.selectAll(".cell")
        .data(data)
        .enter().append("rect")
        .attr("class", "cell")
        .attr("x", d => d.x * cellWidth)
        .attr("y", d => d.y * cellHeight)
        .attr("rx", 3).attr("ry", 3)
        .attr("width", cellWidth - padding)
        .attr("height", cellHeight - padding)
        .style("fill", d => d.count === 0 ? "#f0f0f0" : colorScale(d.count))
        .style("stroke", "#ccc")
        .style("stroke-width", 0.5);
        
    //  Text Labels 
    svgSummary.selectAll(".cell-text-count")
        .data(data.filter(d => d.count > 0))
        .enter().append("text")
        .attr("class", "cell-text-count")
        .attr("x", d => d.x * cellWidth + cellWidth / 2)
        .attr("y", d => d.y * cellHeight + cellHeight / 2 - 5)
        .style("text-anchor", "middle")
        .style("font-size", "14px")
        .style("font-weight", "800")
        .style("fill", d => d.count > maxCount * 0.6 ? "white" : "#111")
        .text(d => d.count.toLocaleString()); 
        
    svgSummary.selectAll(".cell-text-percent")
        .data(data.filter(d => d.percentage > 0))
        .enter().append("text")
        .attr("class", "cell-text-percent")
        .attr("x", d => d.x * cellWidth + cellWidth / 2)
        .attr("y", d => d.y * cellHeight + cellHeight / 2 + 15)
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .style("font-weight", "500")
        .style("fill", d => d.count > maxCount * 0.6 ? "white" : "#444")
        .text(d => `(${d3.format(".1%")(d.percentage)})`);

        
    //  X-Axis (To Type) 
    svgSummary.selectAll(".to-label")
        .data(allTypes)
        .enter().append("text")
        .attr("class", "to-label")
        .attr("x", (d, i) => i * cellWidth + cellWidth / 2)
        .attr("y", -5)
        .style("text-anchor", "middle")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .text(d => REFERENCE_STYLES[d].label.split(' ')[0]); // Use short label (PN, N, P)

    //  Y-Axis 
    svgSummary.selectAll(".from-label")
        .data(primaryTypes)
        .enter().append("text")
        .attr("class", "from-label")
        .attr("x", -5)
        .attr("y", (d, i) => i * cellHeight + cellHeight / 2)
        .attr("dy", "0.35em")
        .style("text-anchor", "end")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .text(d => REFERENCE_STYLES[d].label.split(' ')[0]); // Use short label (PN, N, P)

    // Title 
    svgSummary.append("text")
        .attr("class", "chart-title")
        .attr("x", innerWidth / 2)
        .attr("y", -30)
        .style("text-anchor", "middle")
        .style("font-size", "14px")
        .style("font-weight", "bold")
        .text("Part-of-Speech Transition Counts (All Conversations)");
        
    svgSummary.append("text")
        .attr("class", "chart-subtitle-x")
        .attr("x", innerWidth / 2)
        .attr("y", -15)
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .text(`To Reference Type (X-Axis) | From Reference Type (Y-Axis)`);
}

// graph diagram 
export function renderTransitionGraph(transitionData) {
    const container = d3.select('#sankey-container');
    container.selectAll('*').remove();

    const margin = { top: 50, right: 50, bottom: 50, left: 50 };
    const width = 750;
    const height = 450;
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
    const xMap = { PN: 0, N: innerW * 0.5, P: innerW, End: innerW * 0.5 }; 
    const cy = innerH * 0.5;
    const nodeRadius = 23;

    nodes.forEach(n => {
        n.x = xMap[n.id] ?? innerW * 0.5;
        // Position End node low, N high, others medium
        n.y = (n.id === 'End') ? innerH * 0.9 : (n.id === 'N' ?  innerH * 0.1 : innerH * 0.5); 
    });

    // Assign offsets for reciprocal links
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
    const widthScale = d3.scaleSqrt().domain([0, 1000]).range([2, 14]);

    // Draw defs for arrowheads
    const defs = svg.append('defs');
    Object.keys(REFERENCE_STYLES).forEach(k => {
        defs.append('marker')
            .attr('id', `arrow-${k}`)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', nodeRadius + 2)
            .attr('refY', 5)
            .attr('markerUnits', 'strokeWidth')
            .attr('markerWidth', 3)
            .attr('markerHeight', 3)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0 0 L10 5 L0 10 z')
            .attr('fill', REFERENCE_STYLES[k].color);
    });

    // Draw links (white underlay + colored foreground + label)
    const linkGroup = g.append('g').attr('class', 'links');
    const tooltip = d3.select('#tooltip-s'); // Select the global tooltip element
        
    links.forEach(l => {
        const s = nodes.find(n => n.id === l.source);
        const t = nodes.find(n => n.id === l.target);
        if (!s || !t) return;

        const x1 = s.x;
        const x2 = t.x;
        
        // Base Y positions
        const y1_base = s.y;
        const y2_base = t.y;

        // Apply current vertical offset to y1 and y2
        const offset = l.offset || 0;
        const y1 = y1_base + offset;
        const y2 = y2_base + offset;

        const sw = widthScale(l.value);

        // Calculate Control Point for bending curves
        const cpx = (x1 + x2) / 2;
        const curveDepth = 40; 
        let cpy = y1_base + (offset > 0 ? -curveDepth : curveDepth);
        
        // Handle self-loops
        if (x1 === x2) {
            const loopOffset = offset > 0 ? -80 : 80;
            cpy = y1_base + loopOffset;
        }

        // Define the Quadratic curve path
        const pathGenerator = d3.path();
        pathGenerator.moveTo(x1, y1);
        pathGenerator.quadraticCurveTo(cpx, cpy, x2, y2);
        const pathData = pathGenerator.toString();

        // White underlay 
        linkGroup.append('path')
            .attr('d', pathData)
            .attr('fill', 'none')
            .attr('stroke', '#fff')
            .attr('stroke-width', sw + 6)
            .attr('stroke-linecap', 'round');

        // Colored foreground 
        linkGroup.append('path')
            .attr('d', pathData)
            .attr('fill', 'none')
            .attr('stroke', REFERENCE_STYLES[l.source].color)
            .attr('stroke-width', sw)
            .attr('stroke-linecap', 'round')
            .attr('marker-end', `url(#arrow-${l.source})`)
            .style('cursor', 'pointer')
            .on('mouseover', function (event) {
                // Increase stroke width
                d3.select(this).attr('stroke-width', sw + 3);
                
                // Show tooltip 
                tooltip.transition()
                    .duration(200)
                    .style('opacity', 0.9);
                tooltip.html(`
                    ${l.source} -> ${l.target}<br>
                    Transitions: ${l.value}
                `);
                // Initial positioning
                tooltip.style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 28) + 'px');
            })
            
            // mousemove handler keeps the tooltip tracking
            .on('mousemove', function (event) {
                tooltip
                    .style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 28) + 'px');
            })
            
            .on('mouseout', function () {
                // Restore stroke width
                d3.select(this).attr('stroke-width', sw);
                
                // Hide tooltip
                tooltip.transition()
                    .duration(500)
                    .style('opacity', 0);
            });
        });

    // draw
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



// Rendering Logic: resizing and drawing
// This function was created with the support of Github Copilot.
function updateGraph(data) {
    // NB: data.chainData contains single-turn segments
    const { chainData, mentionData, maxTurnId, totalChains, uniqueChains } = data;

    // DIMENSIONS
    const dynamicHeight = totalChains * heightPerChain;
    const calculatedWidth = (maxTurnId + 1) * PIXELS_PER_TURN; 
    const totalSvgWidth = calculatedWidth + margin.left + margin.right;
    const totalSvgHeight = dynamicHeight + margin.top + margin.bottom;

    // SCALES
    xScale.domain([0, maxTurnId])
        .range([0, calculatedWidth]);

    const yScale = d3.scaleLinear()
        .domain([0, totalChains]) 
        .range([0, dynamicHeight]);

    // UPDATE SVG CONTAINER SIZE
    svg.transition().duration(500)
        .attr("width", totalSvgWidth)
        .attr("height", totalSvgHeight);

    // DRAW/UPDATE AXES
    
    // X-Axis (Turn ID)
    let xAxisGroup = g.select(".x-axis");
    if (xAxisGroup.empty()) {
        xAxisGroup = g.append("g")
            .attr("class", "x-axis");
    }

    xAxisGroup.transition().duration(500)
        .attr("transform", `translate(0,${dynamicHeight})`)
        .call(d3.axisBottom(xScale).tickFormat(d3.format("d")).ticks(maxTurnId + 1));

    // X-Axis label
    g.select(".x-axis-label").remove(); 
    g.append("text")
        .attr("class", "axis-label x-axis-label")
        .attr("x", calculatedWidth / 2)
        .attr("y", totalSvgHeight - margin.bottom / 2)
        .style("text-anchor", "middle")
        .text("Turn ID");

    // Y-Axis (Chain Labels/Index)
    let yAxisGroup = g.select(".y-axis");
    if (yAxisGroup.empty()) {
        yAxisGroup = g.append("g")
            .attr("class", "y-axis");
    }

    const yAxisTicks = yAxisGroup.selectAll(".y-tick")
        .data(uniqueChains, d => d.chain_id); 
    
    // old ticks deleted with transition
    yAxisTicks.exit()
        .transition().duration(500)
        .style("opacity", 0)
        .remove();

    // Create new tick groups
    const newTicks = yAxisTicks.enter().append("g")
        .attr("class", "y-tick");

    // Add Text Labels (Only runs on ENTER)
    newTicks.append("text")
        .attr("class", "chain-label")
        .attr("x", -5) // offset from the axis line
        .attr("dy", "0.35em")
        .style("text-anchor", "end")
        // Initialize text (will be updated below for new and existing)
        .text(d => d.label); 

    // Merge, sort, position all ticks
    const allTicks = newTicks.merge(yAxisTicks)
        // Sort the DOM elements to match data order before transition
        .sort((a, b) => a.y_index - b.y_index); 
        
    // update the text on the merged selection
    allTicks.select(".chain-label") 
        .text(d => d.label);
        
    // Apply position transition to all ticks
    allTicks.transition().duration(750)
        .attr("transform", d => `translate(0, ${yScale(d.y_index) + heightPerChain / 2})`);


    // update legend
    let legendGroup = g.select(".legend-group");
    if (legendGroup.empty()) {
        legendGroup = g.append("g")
            .attr("class", "legend-group")
            .attr("transform", `translate(0, ${LEGEND_Y_OFFSET})`); // Position above the main plot area
    }
    
    // Clear previous items
    legendGroup.selectAll(".legend-title, .segment-legend-item, .marker-legend-item").remove();

    // Segment Opacity Title
    legendGroup.append("text")
        .attr("class", "legend-title legend-title-decay")
        .attr("x", 0)
        .attr("y", -15)
        .style("font-weight", "bold")
        .style("font-size", "10px")
        .text(`Lifespan Opacity: Salience decays by ${SALIENCE_DECAY_RATE * 100}% per turn. (Tooltip counts chains with opacity ≥ ${SALIENCE_THRESHOLD})`);

    // Segment Color Legend
    const segmentKeys = Object.keys(REFERENCE_STYLES).filter(k => k !== 'Other'); // Only show primary types
    let currentX = 0;
    
    const segmentLegendItems = legendGroup.selectAll(".segment-legend-item")
        .data(segmentKeys)
        .enter().append("g")
        .attr("class", "segment-legend-item")
        .attr("transform", (d, i) => {
            let xPos = currentX;
            currentX += LEGEND_ITEM_SPACING;
            return `translate(${xPos}, 0)`;
        });
        
    segmentLegendItems.append("rect")
        .attr("width", LINE_THICKNESS)
        .attr("height", LINE_THICKNESS)
        .attr("rx", 1).attr("ry", 1) // slightly rounded corners
        .style("fill", d => REFERENCE_STYLES[d].color);
        
    segmentLegendItems.append("text")
        .attr("x", LINE_THICKNESS + 4)
        .attr("dy", "0.7em")
        .style("font-size", "10px")
        .text(d => REFERENCE_STYLES[d].label);
        
    // Marker Color Legend 
    // TODO: This function doesn't quite work as intended. 
    const markerKeys = Object.keys(SPEAKER_STYLES);
    currentX += 10; 
    
    const markerLegendItems = legendGroup.selectAll(".marker-legend-item")
        .data(markerKeys)
        .enter().append("g")
        .attr("class", "marker-legend-item")
        .attr("transform", (d, i) => {
            let xPos = currentX;
            currentX += LEGEND_ITEM_SPACING;
            return `translate(${xPos}, 0)`;
        });
        
    const symbolGenerator = d3.symbol().size(60).type(d3.symbolCircle); 
    
    markerLegendItems.append("path")
        .attr("d", d => symbolGenerator())
        .attr("transform", `translate(${LINE_THICKNESS/2}, ${LINE_THICKNESS/2})`) 
        .style("fill", d => SPEAKER_STYLES[d].color);
        
    markerLegendItems.append("text")
        .attr("x", LINE_THICKNESS + 12) 
        .attr("dy", "0.3em")
        .style("font-size", "10px")
        .text(d => SPEAKER_STYLES[d].label);

    
    // update lifespan bands
    const lifespanLines = g.selectAll(".lifespan-segment")
        // Use both chain_id and start_turn for unique key, since segments are now 1 turn long
        .data(chainData, d => `${d.chain_id}-${d.start_turn}`);

    // exit
    lifespanLines.exit().transition().duration(500).style("opacity", 0).remove();

    // enter
    const newLines = lifespanLines.enter()
        .append("rect")
        .attr("class", "lifespan-segment")
        .attr("height", LINE_THICKNESS)
        .attr("y", d => yScale(d.y_index) + heightPerChain / 2 - LINE_THICKNESS / 2)
        .style("opacity", 0);

    // enter+update
    newLines.merge(lifespanLines)
        .transition().duration(750)
        .attr("x", d => xScale(d.start_turn))
        // segments are 1-turn long, the width is fixed to PIXELS_PER_TURN
        .attr("width", PIXELS_PER_TURN) 
        .attr("y", d => yScale(d.y_index) + heightPerChain / 2 - LINE_THICKNESS / 2)
        // fill by the reference type of the segment
        .style("fill", d => {
            const style = REFERENCE_STYLES[d.reference_type] || REFERENCE_STYLES["Other"];
            return style.color;
        })
        // Apply pre-calculated opacity based on salience decay
        .style("opacity", d => d.opacity);
        
    // update mention markers
    const markers = g.selectAll(".mention-marker")
        .data(mentionData, d => `${d.chain_id}-${d.turn_id}`);
        
    markers.exit().transition().duration(500).style("opacity", 0).remove();
    
    const newMarkers = markers.enter()
        .append("path")
        .attr("class", "mention-marker")
        .attr("transform", d => `translate(${xScale(d.turn_id)}, ${yScale(d.y_index) + heightPerChain / 2})`)
        .style("opacity", 0);
        
    newMarkers.merge(markers)
        .transition().duration(750)
        // Use the fixed circle shape for all
        .attr("d", d => symbolGenerator())
        // Color based on the speaker of the current mention
        .style("fill", d => {
            const style = SPEAKER_STYLES[d.speaker] || REFERENCE_STYLES["Other"];
            return style.color;
        })
        .attr("transform", d => `translate(${xScale(d.turn_id) + PIXELS_PER_TURN/2}, ${yScale(d.y_index) + heightPerChain / 2})`)
        .style("opacity", 1);


    // Hover interaction: 

    // Define handler functions inside updateGraph to capture local data/scales
    function handleMouseOver(event, turnId) {
        // Fetch stats based on the pre-calculated, filtered map
        const stats = turnStats.get(turnId) || { P: 0, N: 0, PN: 0, Other: 0 };
        
        // Visual Isolation (Grey out non-hovered columns)
        g.selectAll(".lifespan-segment")
            .style("opacity", function(d) {
                // If the segment is in the hovered turn, use its calculated opacity
                if (d.start_turn === turnId) {
                    return d.opacity; 
                } else {
                    // Otherwise, fade out
                    return 0.1; 
                }
            });
            
        g.selectAll(".mention-marker")
            .style("opacity", function(d) {
                 // Markers are only visible if they are exactly in the hovered turn
                return d.turn_id === turnId ? 1 : 0.1;
            });

        // tooltip generation
        let tooltipX = xScale(turnId) + PIXELS_PER_TURN / 2 + 10; 
        let tooltipY = -15;

        // clear and redraw tooltip content
        tooltip.selectAll("*").remove();

        let totalMentions = stats.P + stats.N + stats.PN + stats.Other;
        
        if (totalMentions > 0) {
            tooltip.append("rect")
                .attr("class", "tooltip-box")
                .attr("rx", 3).attr("ry", 3)
                .style("fill", "#333")
                .style("opacity","0")
                .style("position","absolute")
                .style("color","white")
                .style("padding","5px")
                .style("border-radius","4px")
                .style("pointer-events","none")
                .style("stroke", "#fff")
                .style("stroke-width", "1px")
                .attr("width", 130)
                .attr("height", 80);

            // Tooltip text content
            let lineY = 15;
            tooltip.append("text")
                .attr("x", 5)
                .attr("y", lineY)
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .text(`Turn ${turnId}: ${totalMentions} Salient Mentions`); 
            lineY += 15;
            
            // List counts by type
            ['PN', 'N', 'P'].forEach(type => {
                tooltip.append("text")
                    .attr("x", 5)
                    .attr("y", lineY)
                    .style("font-size", "10px")
                    .text(`${REFERENCE_STYLES[type].label}: ${stats[type] || 0}`);
                lineY += 12;
            });

            // Position the entire tooltip group
            tooltip.attr("transform", `translate(${tooltipX}, ${tooltipY})`);
            tooltip.transition().duration(200).style("opacity", 1);
        }
    }

    function handleMouseOut() {
        // Restore Opacity
        g.selectAll(".lifespan-segment")
            .style("opacity", d => d.opacity);
            
        g.selectAll(".mention-marker")
            .style("opacity", 1); 

        // Hide Tooltip
        g.select(".tooltip-group").transition().duration(500).style("opacity", 0);
    }
    
    // Calculate the number of salient segments (mentions) by reference type per turn for the tooltip
    const turnStats = new Map();
    chainData.forEach(d => {
        // Only count segments if their calculated salience is above the threshold
        if (d.opacity >= SALIENCE_THRESHOLD) {
            const turnId = d.start_turn; 
            if (!turnStats.has(turnId)) {
                turnStats.set(turnId, { P: 0, N: 0, PN: 0, Other: 0 });
            }
            const stats = turnStats.get(turnId);
            const refType = d.reference_type;
            stats[refType] = (stats[refType] || 0) + 1;
        }
    });

    // Tooltip element (SVG group)
    let tooltip = g.select(".tooltip-group");
    if (tooltip.empty()) {
        tooltip = g.append("g")
            .attr("class", "tooltip-group")
            .style("opacity", 0)
            .style("pointer-events", "none"); // Ensure tooltip doesn't interfere with hover areas
    }

    // Create the hover areas for mouse events
    const turnIds = d3.range(maxTurnId + 1); // [0, 1, 2, ..., maxTurnId]

    // FIX: render on top! 
    let hoverAreaGroup = g.select(".hover-area-group");
    if (hoverAreaGroup.empty()) {
        hoverAreaGroup = g.append("g").attr("class", "hover-area-group");
    }

    const hoverAreas = hoverAreaGroup.selectAll(".turn-hover-area")
        .data(turnIds, d => d);

    hoverAreas.exit().remove();

    const newHoverAreas = hoverAreas.enter()
        .append("rect")
        .attr("class", "turn-hover-area")
        // Start above the graph and extend to the bottom axis
        .attr("y", -margin.top) 
        .attr("height", dynamicHeight + margin.top + margin.bottom) 
        .style("fill", "transparent") 
        .style("pointer-events", "all"); // ai suggested; important for capturing events?

    newHoverAreas.merge(hoverAreas)
        // Center the hover area on the tick mark
        .attr("x", d => xScale(d) - PIXELS_PER_TURN / 2) 
        .attr("width", PIXELS_PER_TURN)
        .attr("data-turn-id", d => d)
        // Attach the handlers
        .on("mouseover", handleMouseOver)
        .on("mouseout", handleMouseOut);
}



// Main Drawing
let globalTransitionData = {}; 

export function drawGraph(rawData) {
    // initial data load for comet view
    const initialConvId = 0;
    const timelineData = getTimelineData(rawData, initialConvId);
    
    // Initial estimated dimensions
    const initialCalculatedWidth = (timelineData.maxTurnId + 1) * PIXELS_PER_TURN + margin.left + margin.right;
    const initialDynamicHeight = timelineData.totalChains * heightPerChain;
    const initialTotalSvgHeight = initialDynamicHeight + margin.top + margin.bottom;

    // Initial SVG/G Creation
    svg = d3.select("#graph-container")
        .append("svg")
        .attr("width", initialCalculatedWidth) 
        .attr("height", initialTotalSvgHeight);

    g = svg.append("g")
        .attr("transform",`translate(${margin.left},${margin.top})`);
        
    // Initial Render and Dynamic Sizing
    updateGraph(timelineData);
    
    // Calculate and Render Transition Summary and Graph
    // Determine maximum mentions per chain to configure the slider
    const allChains = d3.group(rawData, d => `${d.conv_id}|${d.chain_id}`);
    const maxChainCount = d3.max(Array.from(allChains.values(), v => v.length)) || 1;

    // Configure slider in the DOM (see index.html)
    const slider = document.getElementById('chain-count-slider');
    const sliderValue = document.getElementById('slider-value');
    if (slider) {
        slider.min = 1;
        slider.max = Math.max(1, maxChainCount);
        slider.value = 1;
    }
    if (sliderValue) sliderValue.textContent = String(slider ? slider.value : '1');

    // Initial render with minimum 1(?) mention per chain
    const initialMin = slider ? +slider.value : 1;
    globalTransitionData = getTransitionStats(rawData, initialMin);
    renderTransitionSummary(globalTransitionData);
    renderTransitionGraph(globalTransitionData);

    // slider (re/)renders both the heatmap and the graph on input
    if (slider) {
        slider.addEventListener('input', (e) => {
            const minCount = +e.target.value;
            if (sliderValue) sliderValue.textContent = String(minCount);
            const updated = getTransitionStats(rawData, minCount);
            renderTransitionSummary(updated);
            renderTransitionGraph(updated);
        });
    }


    // expose the update logic
    window.updateConversation = (newConvId) => {
        
        const newTimelineData = getTimelineData(rawData, newConvId);
        updateGraph(newTimelineData); 
        
    };
}