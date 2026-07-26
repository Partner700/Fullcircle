/*
# Set XAF as default payment display currency

CamPay live payments are configured in XAF, so store prices should display in
XAF by default and for Cameroon phone numbers.
*/

CREATE OR REPLACE FUNCTION get_currency_for_user(p_user_id uuid)
RETURNS TABLE(currency_code text, symbol text, rate_to_usd numeric)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_phone text;
BEGIN
  SELECT whatsapp_number INTO v_phone FROM profiles WHERE id = p_user_id;
  RETURN QUERY
  SELECT c.code, c.symbol, c.rate::numeric FROM (
    VALUES
      ('USD','$',1.0),
      ('XAF','FCFA ',575.0),
      ('NGN','₦',1500.0),
      ('KES','KSh',129.0),
      ('GHS','GH₵',15.0),
      ('ZAR','R',18.5),
      ('EUR','€',0.92),
      ('GBP','£',0.79)
  ) AS c(code, symbol, rate)
  WHERE c.code = CASE
    WHEN v_phone LIKE '+237%' THEN 'XAF'
    WHEN v_phone LIKE '+234%' THEN 'NGN'
    WHEN v_phone LIKE '+254%' THEN 'KES'
    WHEN v_phone LIKE '+233%' THEN 'GHS'
    WHEN v_phone LIKE '+27%' THEN 'ZAR'
    WHEN v_phone LIKE '+44%' THEN 'GBP'
    WHEN v_phone LIKE '+33%' OR v_phone LIKE '+49%' OR v_phone LIKE '+34%' THEN 'EUR'
    ELSE 'XAF'
  END;
END;
$$;
