from nltk.corpus import switchboard
from nltk.corpus.reader.switchboard import SwitchboardTurn
import re


discourses = switchboard.tagged_discourses()

class DiscourseContext:
    def __init__(self, number):
        self.number = number
        try:
            self.raw_discourse_dialogue = discourses[number]
        except IndexError:
            print(f"dialogue #{number} inaccessible: defaulting to #0.")
            self.raw_discourse_dialogue = discourses[0]
        # clean the dialogue for better processing
        self.clean_discourse = []
        for i in self.raw_discourse_dialogue:
            self.clean_discourse.append(self.cleanDisfluencies(i))
            if self.clean_discourse[-1]==None: 
                self.clean_discourse.pop()
        
        self.sentences = sentences = [(turn.speaker, " ".join(word for (word, tag) in turn)) for turn in self.clean_discourse]
                
        
    def cleanDisfluencies(self,swbText):
        cleaner = [(a,b) for (a,b) in swbText if b not in ['UH',',','.','PRN']]
        if len(cleaner) == 0:
            return 
        return SwitchboardTurn(cleaner, swbText.speaker, swbText.id)
        
    def __repr__(self):
        s = f"{self.number} \n \n ------------ \n \n"
        for i in range(len(self.clean_discourse)):
            try:
                # self.discourse_dialogue[i] is a LIST of TUPLES
                # where the TUPLE is (word, Penn tag)
                # so get the words only for repr!
                A = [a for (a,b) in self.clean_discourse[i]]
                s += self.clean_discourse[i].speaker
                s += ":  "
                s += " ".join(A)
                s += '\n'
            except IndexError: 
                break
        s += " \n --------------------------"
        return s



if __name__=='__main__':
    d = DiscourseContext(0)
    print(d.sentences)