class CoreferenceChain:
    """
    Represents a single anaphoric chain (coreference cluster) from a dialogue,
    with methods for tracing reference adaptation.
    """
    def __init__(self, mentions, semantic_type):
        """
        Initialize the chain. Expects a list of dictionaries, where each dict
        is a single, temporally sorted mention with 'cluster_id', 'turn_id', 
        'speaker', and 'type'.
        """
        if not mentions:
            raise ValueError("Chain cannot be initialized with an empty list of mentions.")

        # Store the raw mentions (already sorted by turn_id, start_char)
        self.mentions = mentions
        
        # Metadata
        self.cluster_id = mentions[0].get("cluster_id")
        self.initial_referent_text = mentions[0].get("text")
        self.initial_type = mentions[0].get("type")
        self.semantic_type = semantic_type
        self.length = len(mentions)

    def get_adaptation_trace(self):
        """
        Core trace of reference types over time
        Format: [(turn_id, reference_type, speaker), ...]
        """
        trace = []
        for m in self.mentions:
            trace.append((m["turn_id"], m["type"], m["speaker"]))
        return trace

    def get_tabular_trace(self):
        """
        Generates a tabular representation of the chain's mentions.
        Each row contains: (turn_id, speaker, text, reference_type)
        """
        table = []
        for m in self.mentions:
            table.append({
                "turn_id": m["turn_id"],
                "speaker": m["speaker"],
                "text": m["text"],
                "reference_type": m["type"]
            })
        return table

    def get_transitions(self):
        """
        Generates a list of sequential transitions (Type X -> Type Y) within the chain.
        This is the most crucial output for visualization (Sankey diagrams).
        """
        transitions = []
        
        if self.length < 2:
            return transitions # Cannot have a transition with only one mention

        for i in range(self.length - 1):
            m1 = self.mentions[i]
            m2 = self.mentions[i+1]
            
            transitions.append({
                "conv_id": m1.get("conv_id", "N/A"), # Add conversation ID if available
                "cluster_id": self.cluster_id,
                "turn_start": m1["turn_id"],
                "turn_end": m2["turn_id"],
                "start_type": m1["type"],
                "end_type": m2["type"],
                "speaker_chain": f"{m1['speaker']}->{m2['speaker']}",
                "is_cross_speaker": m1["speaker"] != m2["speaker"]
            })
            
        return transitions

    def __repr__(self):
        return (f"CoreferenceChain(ID={self.cluster_id}, Length={self.length}, Initial='{self.initial_referent_text}' , Type='{self.semantic_type}',({self.initial_type})")

