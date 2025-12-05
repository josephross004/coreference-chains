// js/main.js

import { loadData } from './dataLoader.js';
import { drawGraph } from './graphRenderer.js'; 

const DATA_FILE_PATH = '../data/coreference_chains.csv';

// Main application start for placement in container in HTML
async function initializeApp() {
    const rawData = await loadData(DATA_FILE_PATH);
    
    if (rawData.length > -1) {
        // pass data to function that prepares and draws the graph
        drawGraph(rawData); 

	// set up selector
	setupConversationSelector(rawData);
    }
}

function setupConversationSelector(rawData) {
    // Get unique conv IDs
    const uniqueConvIds = Array.from(new Set(rawData.map(d => d.conv_id)))
        .sort((a, b) => a - b); 

    const select = document.getElementById('conv-select');
    
    // Populate the dropdown
    uniqueConvIds.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `Conversation ${id}`;
        select.appendChild(option);
    });

    // Add the event listener
    select.addEventListener('change', function() {
        const newConvId = +this.value; // convert to numeric
        
        // This calls the function
        if (window.updateConversation) {
            console.log(`Updating graph for Conversation ID: ${newConvId}`);
            window.updateConversation(newConvId);
        }
    });
    
    // initial state
    select.value = uniqueConvIds[-1];
}

initializeApp();
