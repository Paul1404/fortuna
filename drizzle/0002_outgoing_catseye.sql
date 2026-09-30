ALTER TABLE "user_settings" ALTER COLUMN "locale" SET DEFAULT 'de-DE';
--> statement-breakpoint
UPDATE "user_settings" SET "locale" = 'de-DE' WHERE "locale" = 'en-GB';
--> statement-breakpoint
UPDATE "categories"
SET "name" = CASE "slug"
	WHEN 'income' THEN 'Einnahmen'
	WHEN 'salary' THEN 'Gehalt'
	WHEN 'dividends-interest' THEN 'Dividenden & Zinsen'
	WHEN 'refunds' THEN 'Erstattungen'
	WHEN 'other-income' THEN 'Sonstige Einnahmen'
	WHEN 'housing' THEN 'Wohnen'
	WHEN 'rent-mortgage' THEN 'Miete & Darlehen'
	WHEN 'utilities' THEN 'Nebenkosten'
	WHEN 'internet-phone' THEN 'Internet & Telefon'
	WHEN 'household' THEN 'Haushalt'
	WHEN 'groceries' THEN 'Lebensmittel'
	WHEN 'coffee-snacks' THEN 'Kaffee & Snacks'
	WHEN 'mobility' THEN 'Mobilität'
	WHEN 'public-transport' THEN 'Öffentlicher Verkehr'
	WHEN 'car' THEN 'Auto'
	WHEN 'parking-tolls' THEN 'Parken & Maut'
	WHEN 'fuel' THEN 'Kraftstoff'
	WHEN 'insurance' THEN 'Versicherungen'
	WHEN 'shopping' THEN 'Einkäufe'
	WHEN 'clothing' THEN 'Kleidung'
	WHEN 'electronics' THEN 'Elektronik'
	WHEN 'health' THEN 'Gesundheit'
	WHEN 'pharmacy' THEN 'Apotheke'
	WHEN 'travel' THEN 'Reisen'
	WHEN 'technology' THEN 'Technologie'
	WHEN 'hosting-domains' THEN 'Hosting & Domains'
	WHEN 'subscriptions' THEN 'Abonnements'
	WHEN 'news-media' THEN 'Nachrichten & Medien'
	WHEN 'leisure' THEN 'Freizeit'
	WHEN 'education' THEN 'Bildung'
	WHEN 'gifts-donations' THEN 'Geschenke & Spenden'
	WHEN 'taxes-fees' THEN 'Steuern & Gebühren'
	WHEN 'bank-fees' THEN 'Bankgebühren'
	WHEN 'transfers' THEN 'Umbuchungen'
	WHEN 'savings-transfer' THEN 'Sparen'
	WHEN 'credit-card-payment' THEN 'Kreditkartenzahlung'
	WHEN 'investments' THEN 'Wertpapiere'
	WHEN 'loan-repayment' THEN 'Kredittilgung'
	WHEN 'other' THEN 'Sonstiges'
	ELSE "name"
END
WHERE "is_system" = true;
