from coreferencePredictor import predictCoreferenceChain
import pandas as pd
from tqdm import tqdm
# collect all sets of reference chains. 

ds = pd.DataFrame(columns=['conv_id','chain_id','turn_id','speaker','text','reference_type'])

for k in tqdm(range(36)):
    chain_list = predictCoreferenceChain(k)
    for i in tqdm(range(len(chain_list))):
        for j in tqdm(chain_list[i].get_tabular_trace()):
            ds = pd.concat([ds, pd.DataFrame([{'conv_id':k, 'chain_id':i,'turn_id':j['turn_id'], 'speaker':j['speaker'], 'text':j['text'], 'reference_type':j['reference_type']}])], ignore_index=True)

print(ds)
ds.to_csv('coreference_chains.csv', index=False)
        