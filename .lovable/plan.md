

## Analyse de vos paliers vs. la norme NF C 14-100

Voici la comparaison directe entre vos paliers et le tableau normatif NF C 14-100 (facteur de simultaneite ks) :

| Nombre de clients | Vos paliers | NF C 14-100 (ks) |
|---|---|---|
| 1 | 100% | 100% |
| 2-4 | 30% | 100% |
| 5-9 | 30% | 78% |
| 10-14 | 10% | 63% |
| 15-19 | 10% | 53% |
| 20-24 | 5% | 49% |
| 25-39 | 5% | 43% |
| 40-49 | 5% | 40% |
| 50+ | 5% | 38% |

### Le point essentiel : vous avez raison, mais les deux tableaux ne parlent pas de la meme chose

La norme NF C 14-100 definit le ks par rapport a la **puissance appelee reelle** (ce que le client consomme effectivement au pic). Vos paliers s'appliquent a la **puissance contractuelle** (ce que le client a le droit de soutirer).

Le ratio entre les deux est typiquement de **0.25 a 0.40** pour du residentiel standard (un client a 12 kVA appelle rarement plus de 3-5 kVA en pointe).

Si on corrige la norme par ce ratio d'utilisation :

| n clients | NF C 14-100 × ratio utilisation (~0.35) | Vos paliers |
|---|---|---|
| 2-4 | 35% | 30% |
| 5-9 | 27% | 30% |
| 10-14 | 22% | 10% |
| 15-19 | 19% | 10% |
| 20-24 | 17% | 5% |
| 40+ | 14% | 5% |

### Verdict

- **Palier 2-10 clients a 30%** : coherent, bien aligne avec la norme corrigee du ratio d'utilisation.
- **Palier 11-20 clients a 10%** : un peu bas. La norme corrigee donne plutot 17-22%. Valeur terrain de **15-20%** serait plus prudente.
- **Palier 21+ clients a 5%** : egalement bas. La norme corrigee donne 14-17%. Valeur terrain de **10%** serait plus securitaire.

### Recommandation

Si vos mesures terrain confirment ces valeurs basses (10% et 5%), alors elles sont valides pour **votre contexte specifique**. Mais pour un outil generique, des valeurs legerement plus conservatrices seraient plus sures :

| n clients | Proposition ajustee |
|---|---|
| 1 | 100% |
| 2-10 | 30% |
| 11-20 | 15% |
| 21+ | 8% |

Cela reste bien en dessous de la norme NF C 14-100 brute, tout en offrant une petite marge de securite par rapport a vos paliers initiaux. 

A vous de decider : garder vos valeurs terrain exactes ou prendre cette version legerement conservatrice.

