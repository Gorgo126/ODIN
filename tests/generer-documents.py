#!/usr/bin/env python3
"""Fictional personal documents used to test the assistant (thresholds, evaluation).
Writes tests/documents/ in five formats: PDF, DOCX, HTML, MD, TXT. Standard library only.
Run: python3 tests/generer-documents.py"""
import os
import zipfile
from xml.sax.saxutils import escape

DOSSIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'documents')

# Each document: title, then paragraphs; a paragraph starting with '# ' is a heading
BAIL = ('Contrat de location — appartement rue des Lilas', [
    '# Désignation des parties',
    'Le bailleur, la SCI Les Tilleuls, représentée par Mme Hélène Garnier, donne en location au locataire, M. Julien Morel, le logement décrit ci-dessous.',
    '# Objet du contrat',
    'Appartement de type T3 de 64 m², situé au 12 rue des Lilas, 69003 Lyon, au deuxième étage avec cave n° 7. Le logement est loué nu, à usage d\'habitation principale.',
    '# Date de prise d\'effet et durée',
    'Le contrat prend effet le 1er septembre 2024 pour une durée de trois ans, renouvelable par tacite reconduction.',
    '# Conditions financières',
    'Le loyer mensuel, hors charges, est fixé à la somme de 750 euros, payable le 5 de chaque mois par virement bancaire.',
    'Les charges locatives donnent lieu au versement d\'une provision mensuelle de 60 euros, régularisée chaque année au vu des dépenses réelles de l\'immeuble.',
    'Le loyer est révisé chaque année au 1er septembre selon la variation de l\'indice de référence des loyers publié par l\'INSEE.',
    '# Dépôt de garantie',
    'Un dépôt de garantie de 750 euros, correspondant à un mois de loyer hors charges, est versé à la signature. Il est restitué dans un délai maximal d\'un mois après la remise des clés si l\'état des lieux de sortie est conforme.',
    '# Congé',
    'Le logement étant situé en zone tendue, le locataire peut donner congé à tout moment avec un préavis réduit à un mois, par lettre recommandée avec accusé de réception. Le bailleur doit respecter un préavis de six mois avant le terme du bail.',
    '# Assurance',
    'Le locataire est tenu de s\'assurer contre les risques locatifs et d\'en justifier chaque année auprès du bailleur.',
])

RELEVE_MARS = ('Relevé de compte — mars 2026', [
    '# Banque Populaire du Rhône — compte courant n° 04021 88213 17',
    'Titulaire : M. Julien Morel. Période du 1er au 31 mars 2026.',
    'Solde au 1er mars 2026 : 1 118,32 €.',
    '# Opérations',
    '02/03 Virement salaire Imprimerie Duval : +2 150,00 €',
    '05/03 Prélèvement loyer SCI Les Tilleuls : -810,00 €',
    '08/03 Prélèvement EDF électricité : -64,20 €',
    '10/03 Prélèvement Mutuelle Horizon assurance habitation : -23,50 €',
    '12/03 Carte Garage Central Clio révision : -289,40 €',
    '15/03 Carte Supermarché Casino : -132,76 €',
    '21/03 Prélèvement Free Mobile : -19,99 €',
    '27/03 Carte Pharmacie des Brotteaux : -18,40 €',
    '# Récapitulatif',
    'Total des débits : 1 358,25 €. Total des crédits : 2 150,00 €. Solde au 31 mars 2026 : 1 910,07 €.',
])

RELEVE_AVRIL = ('Relevé de compte — avril 2026', [
    'BANQUE POPULAIRE DU RHONE - COMPTE COURANT 04021 88213 17',
    'Période du 1er au 30 avril 2026. Solde au 1er avril : 1 910,07 €.',
    '02/04 Virement salaire Imprimerie Duval : +2 150,00 €',
    '05/04 Prélèvement loyer SCI Les Tilleuls : -810,00 €',
    '08/04 Prélèvement EDF électricité : -58,90 €',
    '10/04 Prélèvement Mutuelle Horizon assurance habitation : -23,50 €',
    '14/04 Remboursement Assurance Maladie soins dentaires : +45,00 €',
    '18/04 Carte Supermarché Casino : -148,12 €',
    '21/04 Prélèvement Free Mobile : -19,99 €',
    'Solde au 30 avril 2026 : 3 044,56 €.',
])

NOTICE = ('Notice d\'utilisation — chaudière Calora Eco 24', [
    '# Présentation',
    'La chaudière murale à condensation Calora Eco 24 assure le chauffage et la production d\'eau chaude sanitaire. Elle fonctionne au gaz naturel.',
    '# Pression de l\'installation',
    'La pression normale du circuit de chauffage, lue sur le manomètre en façade, est comprise entre 1 et 2 bars à froid.',
    '# Codes d\'erreur',
    'E01 : absence de flamme. Vérifiez que le robinet de gaz est ouvert, puis appuyez sur la touche RESET pendant trois secondes. Si le défaut revient, contactez un professionnel.',
    'E04 : pression d\'eau trop basse, inférieure à 0,8 bar. Ouvrez lentement le robinet de remplissage situé sous la chaudière jusqu\'à ce que le manomètre indique 1,5 bar, puis refermez-le.',
    'E09 : surchauffe. Laissez la chaudière refroidir trente minutes et vérifiez que les radiateurs ne sont pas tous fermés.',
    '# Entretien et garantie',
    'Un entretien annuel par un professionnel qualifié est obligatoire. L\'attestation d\'entretien doit être conservée deux ans.',
    'La garantie couvre les pièces pendant deux ans à compter de la date d\'installation, sur présentation de la facture d\'installation.',
])

ASSURANCE = ('Contrat d\'assurance habitation — Mutuelle Horizon', [
    '# Conditions particulières',
    'Contrat n° HAB-2024-55812 souscrit par M. Julien Morel pour le logement situé 12 rue des Lilas, 69003 Lyon. Formule Confort, cotisation mensuelle de 23,50 euros.',
    '# Garanties incluses',
    'Incendie et explosion, dégâts des eaux, catastrophes naturelles, bris de glace des fenêtres et baies vitrées, responsabilité civile vie privée, défense et recours.',
    '# Franchise',
    'Une franchise de 150 euros reste à la charge de l\'assuré pour chaque sinistre, sauf catastrophe naturelle où la franchise légale s\'applique.',
    '# Déclarer un sinistre',
    'Tout dégât des eaux doit être déclaré dans les 5 jours ouvrés suivant sa découverte, par téléphone ou dans l\'espace adhérent, avec le constat amiable signé si un voisin est concerné.',
    'Assistance d\'urgence 24 heures sur 24 : 01 23 45 67 89.',
])

VACCINS = ('Carnet de vaccination de Léa', [
    '# Informations',
    'Léa Morel, née le 14 mars 2021. Médecin traitant : Dr Nadia Benali, cabinet médical des Brotteaux.',
    '# Vaccins réalisés',
    'Diphtérie, tétanos, coqueluche, polio (DTCaP) : injections à 2, 4 et 11 mois.',
    'Rougeole, oreillons, rubéole (ROR) : deux doses, à 12 mois et à 18 mois.',
    'Méningocoque C : une dose à 5 mois, rappel à 12 mois.',
    '# Prochains rendez-vous',
    'Rappel DTCaP prévu en mars 2027, à l\'âge de 6 ans, chez le Dr Benali.',
])

RECETTES = ('Recettes de famille', [
    '# Crêpes de mamie',
    'Pour une vingtaine de crêpes : 250 g de farine, 4 œufs, 50 cl de lait, une pincée de sel et 50 g de beurre fondu.',
    'Mélanger la farine et les œufs, ajouter le lait petit à petit pour éviter les grumeaux, puis le beurre. Laisser reposer la pâte une heure avant la cuisson.',
    '# Gâteau au yaourt',
    'Un pot de yaourt nature, deux pots de sucre, trois pots de farine, un demi-pot d\'huile, trois œufs et un sachet de levure. Cuire 35 minutes à 180 °C.',
])

ATTESTATION = ('Attestation d\'emploi — Imprimerie Duval', [
    '# Imprimerie Duval, 45 avenue Jean Jaurès, 69007 Lyon',
    'Je soussignée, Mme Claire Duval, gérante, atteste que M. Julien Morel est employé dans notre entreprise depuis le 3 février 2021 en contrat à durée indéterminée, au poste de technicien de maintenance.',
    'Il n\'est ni en période d\'essai ni en procédure de licenciement à la date de la présente attestation.',
    'Fait à Lyon le 20 janvier 2026, pour servir et valoir ce que de droit.',
])

GARAGE = ('Facture Garage Central', [
    'GARAGE CENTRAL - 8 rue Paul Bert - 69003 Lyon',
    'Facture n° 2026-0317 du 12 mars 2026. Client : Julien Morel. Véhicule : Renault Clio IV, immatriculation GH-512-KT, 84 300 km.',
    'Révision constructeur : vidange huile moteur, remplacement du filtre à huile et du filtre à air, contrôle des freins.',
    'Total TTC : 289,40 euros, réglé par carte bancaire.',
    'Prochain contrôle technique à réaliser avant le 15 octobre 2026.',
])

COPRO = ('Procès-verbal de l\'assemblée générale de copropriété 2026', [
    '# Résidence Les Lilas — assemblée générale du 9 février 2026',
    'Présents ou représentés : 18 copropriétaires sur 24, soit 812 tantièmes sur 1 000.',
    '# Résolution 5 : ravalement de la façade',
    'L\'assemblée approuve le ravalement de la façade sur rue pour un montant total de 42 000 euros, confié à l\'entreprise Façades Rhône. Les travaux commenceront en juin 2026 pour une durée de dix semaines.',
    'La quote-part du lot 14 (appartement du deuxième étage) s\'élève à 1 260 euros, appelée en deux fois, en mai et en septembre 2026.',
    '# Résolution 7 : local à vélos',
    'La création d\'un local à vélos sécurisé est refusée, faute de majorité.',
])


def texte_brut(titre, paras):
    return titre + '\n\n' + '\n\n'.join(p[2:] if p.startswith('# ') else p for p in paras) + '\n'


def markdown(titre, paras):
    return f'# {titre}\n\n' + '\n\n'.join(('## ' + p[2:]) if p.startswith('# ') else p for p in paras) + '\n'


def html(titre, paras):
    corps = '\n'.join(f'<h2>{escape(p[2:])}</h2>' if p.startswith('# ') else f'<p>{escape(p)}</p>' for p in paras)
    return f'<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>{escape(titre)}</title>\n<style>body{{font-family:sans-serif}}</style><script>console.log("test")</script></head>\n<body><h1>{escape(titre)}</h1>\n{corps}\n</body></html>\n'


def docx(chemin, titre, paras):
    def p(t, style=None):
        pr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
        return f'<w:p>{pr}<w:r><w:t xml:space="preserve">{escape(t)}</w:t></w:r></w:p>'
    corps = p(titre, 'Titre') + ''.join(p(x[2:], 'Titre1') if x.startswith('# ') else p(x) for x in paras)
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    with zipfile.ZipFile(chemin, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')
        z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')
        z.writestr('word/document.xml', f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {ns}><w:body>{corps}</w:body></w:document>')
        z.writestr('docProps/core.xml', f'<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{escape(titre)}</dc:title></cp:coreProperties>')


def pdf(chemin, titre, paras, lignes_par_page=48):
    """Minimal PDF: Helvetica (WinAnsiEncoding), text wrapped at 90 characters, blank line between paragraphs."""
    def couper(t, n=90):
        res, ligne = [], ''
        for mot in t.split():
            if ligne and len(ligne) + 1 + len(mot) > n:
                res.append(ligne)
                ligne = mot
            else:
                ligne = f'{ligne} {mot}'.strip()
        return res + [ligne]
    lignes = [titre, '']
    for p in paras:
        lignes += couper(p[2:] if p.startswith('# ') else p) + ['']
    pages = [lignes[i:i + lignes_par_page] for i in range(0, len(lignes), lignes_par_page)]
    enc = lambda s: s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)').encode('cp1252')
    objets = []
    n_pages = len(pages)
    kids = ' '.join(f'{4 + 2 * i} 0 R' for i in range(n_pages))
    objets.append(b'<< /Type /Catalog /Pages 2 0 R >>')
    objets.append(f'<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>'.encode())
    objets.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    for page in pages:
        flux = b'BT /F1 11 Tf 50 800 Td 15 TL\n' + b''.join(b'(' + enc(l) + b") '\n" for l in page) + b'ET'
        objets.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {len(objets) + 2} 0 R >>'.encode())
        objets.append(f'<< /Length {len(flux)} >>\nstream\n'.encode() + flux + b'\nendstream')
    sortie = bytearray(b'%PDF-1.4\n')
    positions = []
    for i, o in enumerate(objets, 1):
        positions.append(len(sortie))
        sortie += f'{i} 0 obj\n'.encode() + o + b'\nendobj\n'
    xref = len(sortie)
    sortie += f'xref\n0 {len(objets) + 1}\n0000000000 65535 f \n'.encode()
    sortie += b''.join(f'{p:010d} 00000 n \n'.encode() for p in positions)
    sortie += f'trailer\n<< /Size {len(objets) + 1} /Root 1 0 R /Info << /Title ({titre.encode("ascii", "ignore").decode()}) >> >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    with open(chemin, 'wb') as f:
        f.write(sortie)


def ecrire(nom, contenu, encodage='utf-8'):
    with open(os.path.join(DOSSIER, nom), 'w', encoding=encodage, newline='\n') as f:
        f.write(contenu)


os.makedirs(os.path.join(DOSSIER, 'banque'), exist_ok=True)
docx(os.path.join(DOSSIER, 'bail-appartement.docx'), *BAIL)
pdf(os.path.join(DOSSIER, 'banque', 'releve-2026-03.pdf'), *RELEVE_MARS)
# Older Windows export: Windows-1252, as some banks still produce
ecrire('banque/releve-2026-04.txt', texte_brut(*RELEVE_AVRIL), 'cp1252')
pdf(os.path.join(DOSSIER, 'notice-chaudiere-calora.pdf'), *NOTICE)
ecrire('assurance-habitation.html', html(*ASSURANCE))
ecrire('carnet-vaccins-lea.md', markdown(*VACCINS))
ecrire('recettes-famille.md', markdown(*RECETTES))
pdf(os.path.join(DOSSIER, 'attestation-employeur.pdf'), *ATTESTATION)
ecrire('facture-garage-2026-03.txt', texte_brut(*GARAGE))
docx(os.path.join(DOSSIER, 'ag-copropriete-2026.docx'), *COPRO)
# Unsupported format: must be logged, never break the indexing
with open(os.path.join(DOSSIER, 'photo-facade.jpg'), 'wb') as f:
    f.write(b'\xff\xd8\xff\xe0 not a real picture')
print('Documents écrits dans', DOSSIER)
