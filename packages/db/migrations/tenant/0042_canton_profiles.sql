-- Switzerland: Canton Profiles (ticket 47).

-- the property's Canton Profile (who registers, fields, form per adult/couple/family, retention, document copy, signature, transmission)
alter table properties add column canton_profile jsonb;

alter table registrations drop constraint registrations_country_check;
alter table registrations add constraint registrations_country_check check (country in ('DE', 'AT', 'CH'));
-- the profile as it was when the registration opened: a later change does not alter an open form
alter table registrations add column profile jsonb;

-- the federal minimum in Switzerland: place of birth, document type and number; Tessin asks the car's number
alter table registration_persons add column place_of_birth text not null default '';
alter table registration_persons add column document_type text not null default '' constraint registration_persons_document_type_check check (document_type in ('', 'passport', 'id_card', 'other'));
alter table registration_persons add column car_number text not null default '';
