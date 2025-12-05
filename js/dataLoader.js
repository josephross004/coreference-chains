// js/dataLoader.js

// import d3 loading function
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// mapping and type conversion logic only once
const SALIENCE_MAP = { "P": 3, "N": 2, "PN": 1 };

// data mapping to row structure
const rowConverter = (d) => ({
    conv_id: +d.conv_id,
    chain_id: +d.chain_id,
    turn_id: +d.turn_id,
    speaker: d.speaker,
    text: d.text,
    reference_type: d.reference_type,
    salience_score: SALIENCE_MAP[d.reference_type] || 0 
});

// export function for loading and returning cleaned data from CSV file
export async function loadData(filePath) {
    try {
        const rawData = await d3.csv(filePath, rowConverter);
        console.log("Data loaded and cleaned:", rawData);
        return rawData;
    } catch (error) {
        console.error("Error loading data from file:", filePath, error);
        return [];
    }
}
