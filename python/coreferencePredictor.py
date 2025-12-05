from fastcoref import FCoref
from switchboardLoader import DiscourseContext
import re 
from coreferenceChain import CoreferenceChain
from referenceTypeClassify import classify_reference_type, classify_entity_type

def predictCoreferenceChain(number):
    # Keeping track of dialogue and turn
    d = DiscourseContext(number)
    dialogue_text = ""
    turn_map = []
    current_index = 0

    for turn_id, (speaker, sentence) in enumerate(d.sentences):
        # Format the turn exactly like in the input text
        # e.g., "A: I think so. "
        turn_prefix = f"{speaker}: "
        full_turn_text = turn_prefix + sentence.strip() + " "
        
        start_index = current_index
        end_index = current_index + len(full_turn_text)
        
        turn_map.append({
            "start": start_index,
            "end": end_index,
            "speaker": speaker,
            "turn_id": turn_id,
            "text": sentence.strip()
        })
        
        dialogue_text += full_turn_text
        current_index = end_index

    # FCoref run on the dialogue text. 
    model = FCoref(device='cpu')
    preds = model.predict([dialogue_text])
    clusters_with_indices = preds[0].get_clusters(as_strings=False) 

    # populate the Chain structures
    processed_chains = []

    for cluster_id, cluster in enumerate(clusters_with_indices):
        chain_mentions = []
        
        for start_char, end_char in cluster:
            # initialize whose turn is it? 
            correct_turn = None
            for turn_data in turn_map:
                # Check if the mention's indices fall within the turn's boundaries
                # NOTE: distinction between inclusive and exclusive inequalities
                # is finnicky with FCoRef. This decision was made based solely on trial
                # and error. 
                if start_char >= turn_data["start"] and end_char <= turn_data["end"]:
                    correct_turn = turn_data
                    break
            
            if correct_turn:
                # classify text
                mention_text = dialogue_text[start_char:end_char]
                mention_type = classify_reference_type(mention_text)
                
                # mention dictionary: get info about each mention to store.
                mention_dict = {
                    "cluster_id": cluster_id,
                    "start_char": start_char,
                    "end_char": end_char,
                    "speaker": correct_turn["speaker"],
                    "turn_id": correct_turn["turn_id"],
                    "text": mention_text.strip(),
                    "type": mention_type
                }
                chain_mentions.append(mention_dict)
                
        # sort by mention time
        chain_mentions.sort(key=lambda x: (x["turn_id"], x["start_char"]))
        
        processed_chains.append(chain_mentions)

    all_chain_objects = []

    for chain_mentions in processed_chains:
        if chain_mentions:
            initial_text = chain_mentions[0]["text"]
            entity_type = classify_entity_type(initial_text)
            try:
                chain_object = CoreferenceChain(chain_mentions, entity_type)
                all_chain_objects.append(chain_object)
            except ValueError as e:
                print(f"Skipped chain: {e}")

    print(f"Created {len(all_chain_objects)} CoreferenceChain objects.")


    return all_chain_objects
