from stdPronouns import PRONOUNS, PERSON_PRONOUNS
import spacy

# Load spaCy model 
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("Warning: spaCy model 'en_core_web_sm' not found. Please run 'python -m spacy download en_core_web_sm'")
    nlp = None 

ENTITY_TYPE_MAP = {
    # Person Categories
    'PERSON': 'PERSON', 
    'NORP': 'PERSON',   # Nationalities, religious or political groups (often refer to people)
    
    # Place Categories
    'LOC': 'PLACE',    # Non-GPE locations, mountain ranges, bodies of water
    'GPE': 'PLACE',    # Countries, cities, states
    'FAC': 'PLACE',    # Buildings, airports, highways, bridges
    
    # Object/Thing Categories (Often nominals)
    'ORG': 'OBJECT',    # Companies, agencies, institutions
    'PRODUCT': 'OBJECT',
    'EVENT': 'OBJECT',
    'WORK_OF_ART': 'OBJECT',
    'LAW': 'OBJECT',
    'DATE': 'OBJECT',   # Though temporal, often treated as a thing in discourse
    'TIME': 'OBJECT',
    'PERCENT': 'OBJECT',
    'MONEY': 'OBJECT',
    'QUANTITY': 'OBJECT',
    'ORDINAL': 'OBJECT',
    'CARDINAL': 'OBJECT',
    
    # Default/Unknown
    'OTHER': 'OBJECT' # Catch-all for unlabeled or generic nominals
}

def classify_reference_type(mention_text):
    """Classifies a mention text as Proper Noun (PN), Pronominal (P), or Nominal (N)."""
    text = mention_text.strip().lower()

    if text in PRONOUNS:
        return "P" 
    
    # Heuristic for proper nouns. 
    # capitalization and not single letters
    if len(text) > 1 and mention_text.strip()[0].isupper() and (not any(char.isdigit() for char in text)):
        return "PN" 
    
    # or nominal (base)
    return "N"


# spacy model loading only once for computational efficiency
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("Warning: spaCy model 'en_core_web_sm' not found. Please run 'python -m spacy download en_core_web_sm'")
    nlp = None # Handle case where model is missing


def classify_entity_type(mention_text):
    text = mention_text.strip().lower()
    if text in PERSON_PRONOUNS:
        if text in {"it", "its"}: 
             return "OBJECT"
        return "PERSON"

    """Uses spaCy's NER to classify the initial mention's semantic type."""
    if not nlp:
        return "UNKNOWN_NER"
        
    doc = nlp(text)
    
    # Only classify the first, most prominent entity found
    if doc.ents:
        spacy_label = doc.ents[0].label_
        return ENTITY_TYPE_MAP.get(spacy_label, 'OBJECT') # Default to OBJECT
        
    return "OBJECT" # Default to 'OBJECT' if no NER match