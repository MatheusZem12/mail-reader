package com.mailreader.mailreaderbackend.service;

import com.mailreader.mailreaderbackend.dto.EmailAccountDto;
import com.mailreader.mailreaderbackend.dto.EmailDetailDto;
import com.mailreader.mailreaderbackend.dto.EmailSummaryDto;
import jakarta.mail.*;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMultipart;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;

@Service
public class EmailService {

    public List<EmailSummaryDto> listEmails(EmailAccountDto account, int page, int size) throws MessagingException {
        Store store = null;
        Folder folder = null;
        try {
            store = openStore(account);
            folder = openFolder(store, account.getFolder(), Folder.READ_ONLY);

            Message[] messages = folder.getMessages();
            int total = messages.length;
            int fromIndex = Math.max(0, total - (page + 1) * size);
            int toIndex = Math.max(0, total - page * size);

            List<EmailSummaryDto> result = new ArrayList<>();
            for (int i = toIndex - 1; i >= fromIndex; i--) {
                Message message = messages[i];
                result.add(mapToSummary(message));
            }
            return result;
        } finally {
            closeQuietly(folder);
            closeQuietly(store);
        }
    }

    public EmailDetailDto getEmail(EmailAccountDto account, int messageNumber) throws MessagingException, IOException {
        Store store = null;
        Folder folder = null;
        try {
            store = openStore(account);
            folder = openFolder(store, account.getFolder(), Folder.READ_WRITE);
            Message message = folder.getMessage(messageNumber);
            if (message == null) {
                throw new NoSuchElementException("E-mail não encontrado: " + messageNumber);
            }
            message.setFlag(Flags.Flag.SEEN, true);
            return mapToDetail(message);
        } finally {
            closeQuietly(folder);
            closeQuietly(store);
        }
    }

    public void deleteEmail(EmailAccountDto account, int messageNumber) throws MessagingException {
        Store store = null;
        Folder folder = null;
        try {
            store = openStore(account);
            folder = openFolder(store, account.getFolder(), Folder.READ_WRITE);
            Message message = folder.getMessage(messageNumber);
            if (message == null) {
                throw new NoSuchElementException("E-mail não encontrado: " + messageNumber);
            }
            message.setFlag(Flags.Flag.DELETED, true);
        } finally {
            if (folder != null) {
                try {
                    folder.close(true);
                } catch (MessagingException ignored) {
                }
            }
            closeQuietly(store);
        }
    }

    private Store openStore(EmailAccountDto account) throws MessagingException {
        Properties props = new Properties();
        props.put("mail.store.protocol", account.getProtocol());

        if ("imaps".equalsIgnoreCase(account.getProtocol())) {
            props.put("mail.imaps.ssl.enable", "true");
            props.put("mail.imaps.ssl.trust", "*");
        } else if ("imap".equalsIgnoreCase(account.getProtocol())) {
            props.put("mail.imap.starttls.enable", "true");
        }

        Session session = Session.getInstance(props);
        Store store = session.getStore(account.getProtocol());
        int port = account.getPort() != null ? account.getPort() : -1;
        store.connect(account.getHost(), port, account.getUsername(), account.getPassword());
        return store;
    }

    private Folder openFolder(Store store, String folderName, int mode) throws MessagingException {
        Folder folder = store.getFolder(folderName != null ? folderName : "INBOX");
        if (!folder.exists()) {
            throw new MessagingException("Pasta não encontrada: " + folderName);
        }
        folder.open(mode);
        return folder;
    }

    private EmailSummaryDto mapToSummary(Message message) throws MessagingException {
        EmailSummaryDto dto = new EmailSummaryDto();
        dto.setMessageNumber(message.getMessageNumber());
        dto.setSubject(message.getSubject());
        dto.setFrom(formatAddresses(message.getFrom()));
        dto.setReceivedDate(message.getReceivedDate());
        dto.setSeen(message.isSet(Flags.Flag.SEEN));
        return dto;
    }

    private EmailDetailDto mapToDetail(Message message) throws MessagingException, IOException {
        EmailDetailDto dto = new EmailDetailDto();
        dto.setMessageNumber(message.getMessageNumber());
        dto.setSubject(message.getSubject());
        dto.setFrom(formatAddresses(message.getFrom()));
        dto.setTo(formatAddressList(message.getRecipients(Message.RecipientType.TO)));
        dto.setReceivedDate(message.getReceivedDate());
        dto.setSeen(message.isSet(Flags.Flag.SEEN));
        dto.setContentType(message.getContentType());

        Object content = message.getContent();
        dto.setBody(extractText(content));
        dto.setAttachmentNames(extractAttachmentNames(content));
        return dto;
    }

    private String extractText(Object content) throws MessagingException, IOException {
        if (content instanceof String) {
            return (String) content;
        }
        if (content instanceof MimeMultipart multipart) {
            return extractTextFromMultipart(multipart);
        }
        return "";
    }

    private String extractTextFromMultipart(MimeMultipart multipart) throws MessagingException, IOException {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < multipart.getCount(); i++) {
            BodyPart part = multipart.getBodyPart(i);
            if (Part.ATTACHMENT.equalsIgnoreCase(part.getDisposition())) {
                continue;
            }
            Object partContent = part.getContent();
            if (partContent instanceof String) {
                sb.append(partContent);
            } else if (partContent instanceof MimeMultipart nested) {
                sb.append(extractTextFromMultipart(nested));
            }
        }
        return sb.toString();
    }

    private List<String> extractAttachmentNames(Object content) throws MessagingException, IOException {
        List<String> names = new ArrayList<>();
        if (content instanceof MimeMultipart multipart) {
            extractAttachmentNamesFromMultipart(multipart, names);
        }
        return names;
    }

    private void extractAttachmentNamesFromMultipart(MimeMultipart multipart, List<String> names) throws MessagingException, IOException {
        for (int i = 0; i < multipart.getCount(); i++) {
            BodyPart part = multipart.getBodyPart(i);
            if (Part.ATTACHMENT.equalsIgnoreCase(part.getDisposition()) || part.getFileName() != null) {
                names.add(part.getFileName());
            } else if (part.getContent() instanceof MimeMultipart nested) {
                extractAttachmentNamesFromMultipart(nested, names);
            }
        }
    }

    private String formatAddresses(Address[] addresses) {
        if (addresses == null || addresses.length == 0) {
            return "";
        }
        StringJoiner joiner = new StringJoiner(", ");
        for (Address address : addresses) {
            if (address instanceof InternetAddress internetAddress) {
                String personal = internetAddress.getPersonal();
                joiner.add(personal != null ? personal + " <" + internetAddress.getAddress() + ">" : internetAddress.getAddress());
            } else {
                joiner.add(address.toString());
            }
        }
        return joiner.toString();
    }

    private List<String> formatAddressList(Address[] addresses) {
        if (addresses == null) {
            return Collections.emptyList();
        }
        List<String> list = new ArrayList<>();
        for (Address address : addresses) {
            list.add(address.toString());
        }
        return list;
    }

    private void closeQuietly(Folder folder) {
        if (folder != null && folder.isOpen()) {
            try {
                folder.close(false);
            } catch (MessagingException ignored) {
            }
        }
    }

    private void closeQuietly(Store store) {
        if (store != null && store.isConnected()) {
            try {
                store.close();
            } catch (MessagingException ignored) {
            }
        }
    }
}
